# Eventory Backend API

Complete API documentation for the Eventory backend.

- **Base URL:** `http://localhost:5000/api`
- **Database:** MongoDB (Mongoose), configured in `.env` (`MONGO_URI`)
- **Stack:** Node.js, Express, no external auth libraries (Node `crypto` only)

---

## Conventions

### Response envelope

Every response uses a consistent envelope:

```jsonc
// Success
{ "success": true, "data": { ... }, "count": 42 }   // count only on list endpoints

// Error
{ "success": false, "message": "Human-readable reason" }
// In development the error also includes "stack".
```

### Authentication

Send the JWT in the header of every protected request:

```
Authorization: Bearer <token>
```

Tokens are HS256-signed, expire after **7 days**, and carry `{ id, role, iat, exp }`.

- Public GET endpoints work **with or without** a token; when a booker sends a token,
  scoped reads (own events/bookings) apply.
- Missing token on a protected route → `401`
- Insufficient role on a protected route → `403`

### Roles

| Role         | Capabilities |
|--------------|--------------|
| `booker`     | Register/login, create & manage **own** events and requirements, submit/cancel **own** bookings, view own dashboard |
| `management` | Everything above for **any** event, plus create/update/delete venues, resources, reservations, organizations; approve/reject bookings; management dashboard |

There is no privilege escalation: a `bookerId` sent in a request body is ignored —
ownership always comes from the token.

### Status codes

| Code | Meaning |
|------|---------|
| 200  | OK |
| 201  | Created |
| 400  | Validation error / missing field / bad reference |
| 401  | Not authenticated (missing/invalid token) or wrong credentials |
| 403  | Authenticated but not allowed (role or ownership) |
| 404  | Resource not found |
| 409  | Conflict (duplicate, wrong state, or booking conflicts) |
| 500  | Server error |

---

## Health

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | none |

```json
{ "success": true, "status": "ok", "database": "connected", "timestamp": "..." }
```

---

## Authentication

### POST `/api/auth/register`

Body:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "secret123",          // min 6 characters
  "role": "booker",                 // optional: "booker" (default) | "management"
  "organizationId": "65..."          // optional, must exist
}
```

`201` → `{ "success": true, "data": { "token": "...", "user": { "_id", "name", "email", "role", "organizationId", "createdAt" } } }`

Errors: `400` missing/short password, unknown organization; `409` email already registered.

### POST `/api/auth/login`

Body: `{ "email": "jane@example.com", "password": "secret123" }`

`200` → same payload as register. `401` for unknown email **or** wrong password
(same message for both, so the endpoint never reveals which accounts exist).

### GET `/api/auth/me`

Requires token. `200` → the public user object (never includes the password).

---

## Organizations

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/organizations` | none |
| GET | `/api/organizations/:id` | none |
| POST | `/api/organizations` | management |
| PUT | `/api/organizations/:id` | management |
| DELETE | `/api/organizations/:id` | management |

Body (create/update): `{ "name": "Computer Studies" }`

---

## Events

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/events` | public (bookers get **only their own**) |
| GET | `/api/events/:id` | public; bookers only own events |
| POST | `/api/events` | authenticated (owner stamped from token) |
| PUT | `/api/events/:id` | owner or management |
| DELETE | `/api/events/:id` | owner or management |

Deleting an event also deletes its requirements, reservations and bookings
(stock holds and booking lists must not outlive the event).

**Status follows the booking** — `pending | approved | rejected | cancelled |
completed` (lowercase). The value is derived, never chosen: creating an event or
submitting a booking sets `pending`, approving sets `approved`, rejecting sets
`rejected`, and withdrawing a pending booking returns it to `pending`.

**Terminal transitions on update** (cascades run only when the status actually changes):

- → `completed` — **management only** (owner attempts → `403`). Releases every
  stock hold: reservations `reserved`/`issued` → `returned`, the event's
  `Approved` bookings → `Completed`, and its `Pending` bookings → `Cancelled`.
- → `cancelled` — owner or management. Drops the holds (`reserved`/`issued` →
  `cancelled`) and closes open bookings (`Pending`/`Approved` → `Cancelled`).
- Any other status value → `400` ("Event status follows the booking and can
  only be set to 'completed' or 'cancelled'.").
- Reopening a cancelled/completed event does **not** restore holds.

**Create body:**

```json
{
  "organization": "65...",          // optional
  "venue": "65...",                 // optional
  "name": "Tech Summit",
  "description": "...",             // optional
  "startDate": "2027-10-20T13:00:00+08:00",
  "endDate": "2027-10-20T16:00:00+08:00"
}
```

`endDate` must be after `startDate` (model validator). `status` is not accepted
on create — events start as `pending` and then follow their booking.

A booker whose account has an `organizationId` may only create events for that
organization (`400` "You can only create events for your own organization." if
another org is given); when the field is omitted it is stamped with the
booker's organization. Bookers without an organization and management users
may pick any organization (management typically assigns one).

**List:** `GET /api/events` → `{ success, count, data: [...] }`, sorted by `startDate`.

### GET `/api/events/:id/conflicts`

Grouped arrays **and** the flat spec list:

```json
{
  "success": true,
  "data": {
    "event": { "id": "...", "name": "...", "startDate": "...", "endDate": "..." },
    "venueConflicts": [ ... ],
    "scheduleConflicts": [ ... ],
    "resourceConflicts": [ ... ],
    "conflicts": [
      { "type": "VENUE_CONFLICT", "venue": "AVR", "event": "Other Fest", "startDate": "...", "endDate": "..." },
      { "type": "SCHEDULE_CONFLICT", "event": "Other Fest", "startDate": "...", "endDate": "..." },
      { "type": "RESOURCE_SHORTAGE", "resource": "Projector", "resourceId": "...", "required": 5, "available": 1, "shortage": 4 },
      { "type": "INVALID_SCHEDULE", "message": "End time is not after start time" }
    ],
    "hasConflicts": true
  }
}
```

Overlap rule everywhere: `existing.start < requested.end && existing.end > requested.start`.
Cancelled and completed events hold nothing, so they are never reported as conflicts.
Venue clashes are checked first; a pair already reported as a venue conflict is not
duplicated as a schedule conflict.

### GET `/api/events/:id/readiness`

```json
{
  "success": true,
  "data": {
    "ready": true,
    "venueAvailable": true,
    "resourceIssues": [ { "resource": "...", "required": 5, "available": 8, "shortage": 0 } ],
    "conflicts": [ ... ]
  }
}
```

`ready` = venue assigned, active, free, valid schedule, and every requirement covered.

### Resource requirements

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/events/:eventId/requirements` | public (booker scoping as events) |
| POST | `/api/events/:eventId/requirements` | event owner or management |
| PUT | `/api/events/:eventId/requirements/:requirementId` | event owner or management |
| DELETE | `/api/events/:eventId/requirements/:requirementId` | event owner or management |

Create body: `{ "resource": "65...", "quantity": 2, "requiredDate": "...", "priority": "high", "notes": "..." }`

- `resource` required, must exist.
- `requiredDate` defaults to the event start date.

### GET `/api/events/statistics`

```json
{
  "success": true,
  "data": {
    "total": 12,
    "byStatus": [ { "status": "pending", "count": 5 }, ... ],
    "byOrganization": [ { "organization": "CS", "count": 4 }, ... ],
    "monthly": [ { "month": "2027-10", "count": 3 }, ... ]
  }
}
```

---

## Venues

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/venues` | none |
| GET | `/api/venues/:id` | none |
| GET | `/api/venues/:id/availability` | none |
| POST | `/api/venues` | management |
| PUT | `/api/venues/:id` | management |
| DELETE | `/api/venues/:id` | management |

Body: `{ "name": "AVR", "capacity": 100, "isActive": true }`

### GET `/api/venues/:id/availability`

Query: `?start=ISO&end=ISO` **or** `?date=YYYY-MM-DD` (whole day).

```json
{
  "success": true,
  "data": {
    "venue": { "id": "...", "name": "AVR", "capacity": 100, "isActive": true },
    "requested": { "start": "...", "end": "..." },
    "available": false,
    "conflicts": [ { "name": "Tech Summit", "startDate": "...", "endDate": "...", "status": "pending" } ]
  }
}
```

`400` when `start`/`end` (or `date`) are missing or invalid; `available` is `false`
for inactive venues.

---

## Resources

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/resources` | none |
| GET | `/api/resources/:id` | none |
| GET | `/api/resources/:id/availability` | none |
| GET | `/api/resources/utilization` | none |
| POST | `/api/resources` | management |
| PUT | `/api/resources/:id` | management |
| DELETE | `/api/resources/:id` | management |

Body: `{ "name": "Projector", "category": "audio_visual", "quantityTotal": 3, "unit": "unit", "isAvailable": true }`

- New resources start fully available (`quantityAvailable = quantityTotal`).

### GET `/api/resources/:id/availability`

```
Available = quantityTotal − Σ quantity of active (reserved|issued) reservations
```

```json
{
  "success": true,
  "data": { "resource": { "id": "...", "name": "Projector", "unit": "unit" }, "total": 3, "reserved": 2, "available": 1, "activeReservations": 1 }
}
```

### GET `/api/resources/utilization`

```json
{ "success": true, "data": { "resources": [ { "_id": "...", "name": "Projector", "utilization": 66 } ], "averageUtilization": 66 } }
```

Utilization = `reserved / total × 100`, capped at 100.

---

## Reservations

Direct stock holds created by management (independent of the booking workflow).

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/reservations` | none |
| GET | `/api/reservations/:id` | none |
| POST | `/api/reservations` | management |
| PUT | `/api/reservations/:id` | management |
| DELETE | `/api/reservations/:id` | management |

Body: `{ "event": "65...", "resource": "65...", "quantity": 2, "notes": "..." }`

Creating/updating validates `quantity ≤ available` (same math as the availability
endpoint) and returns `400` when stock is insufficient. An active hold
(`reserved`/`issued`) for a **cancelled** event → `409`. Statuses: `reserved`,
`issued`, `returned`, `cancelled` (model default `reserved`).

---

## Bookings

The booking workflow is separate from reservations: a **booking** is the request a
booker submits for an event; **approving** it creates the resource reservations
(holds) automatically.

Statuses (exact casing): `Pending` → `Approved` | `Rejected` | `Cancelled`;
`Approved` bookings become `Completed` when their event is completed.

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/bookings` | authenticated (booker: own events only; management: any) |
| GET | `/api/bookings?status=Pending` | authenticated (bookers: own; management: all) |
| GET | `/api/bookings/:id` | owner or management |
| PUT | `/api/bookings/:id/cancel` | owner (or management), must be `Pending` |
| PUT | `/api/bookings/:id/approve` | management |
| PUT | `/api/bookings/:id/reject` | management |

### POST `/api/bookings`

Body: `{ "eventId": "65...", "notes": "optional" }`

Rules:
- Event must exist and not be cancelled or completed → else `409`.
- The event must not have already ended (`endDate < now`) → else `409`
  ("This event has already ended. Update the event dates before submitting a
  booking."). This is the resubmit guard: rejected bookings may always be
  submitted again once the dates are updated.
- A booker can only book **their own** event → else `403`.
- One booking per event: `Pending`/`Approved`/`Completed` block a new request
  → `409`. After a `Rejected` or `Cancelled` booking, resubmitting **reuses
  the original row** (reset to `Pending`, `rejectionReason` cleared, duplicates
  from older versions collapsed) → `200` instead of `201`.
- The event's status is (re)set to `pending`.

`201` (new booking) / `200` (resubmit) → booking with populated `eventId` and `bookerId`:

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "eventId": { "_id": "...", "name": "Tech Summit", "startDate": "...", "endDate": "...", "status": "pending", "venue": "...", "organization": "...", "bookerId": "..." },
    "bookerId": { "_id": "...", "name": "Jane Doe", "email": "...", "role": "booker" },
    "status": "Pending",
    "notes": "...",
    "createdAt": "..."
  }
}
```

### GET `/api/bookings`

Query: `?status=Pending|Approved|Rejected|Cancelled|Completed` (invalid value → `400`).
Sorted newest first, returns `{ success, count, data }`.

### PUT `/api/bookings/:id/approve` — management

Runs the full spec workflow:

1. Booking must be `Pending`.
2. Event exists and is not cancelled or completed.
3. Venue exists and is active.
4. Collects conflicts: `INVALID_SCHEDULE`, `VENUE_CONFLICT`, `SCHEDULE_CONFLICT`
   (same organization, different venue), `RESOURCE_SHORTAGE`
   (`Available = Total − Reserved` by *other* events).
5. If **any** conflict exists → `409` **without** changing anything:

```json
{
  "success": false,
  "message": "There are not enough resources to approve this booking.",
  "conflicts": [
    { "type": "RESOURCE_SHORTAGE", "resource": "Projector", "resourceId": "...", "required": 5, "available": 1, "shortage": 4 }
  ]
}
```

Message depends on the first conflict: `INVALID_SCHEDULE` → invalid schedule,
`VENUE_CONFLICT` → venue already booked, `SCHEDULE_CONFLICT` → overlaps another
event of the same organization, `RESOURCE_SHORTAGE` → not enough resources.

6. Otherwise creates one reservation per requirement (only the amount not already
   held by the same event) and responds `200` with the booking as `Approved`
   and the event as `approved`.

### PUT `/api/bookings/:id/reject`

Body **required:** `{ "rejectionReason": "Venue reserved for maintenance." }`
(missing/empty → `400`). Only `Pending` bookings → else `409`. The event moves
to `rejected` (a rejected booking never blocks a resubmission).

### PUT `/api/bookings/:id/cancel`

Owner cancels their own booking (management may cancel any). Only `Pending` →
else `409`. Responds `200` with status `Cancelled`; the event returns to
`pending` (withdrawing a request does not mean the event was called off).

---

## Dashboards

### GET `/api/dashboard/summary` — public

Powers the landing dashboard in one request:

```json
{
  "success": true,
  "data": {
    "stats": { "totalEvents": 8, "upcomingEvents": 3, "confirmedEvents": 4, "totalResources": 5, "activeReservations": 3, "conflicts": 2 },
    "upcoming": [ { "_id": "...", "name": "...", "startDate": "...", "endDate": "...", "status": "pending", "venue": "AVR" } ],
    "recentConflicts": [ { "type": "venue", "message": "A and B share AVR", "date": "..." } ],
    "resourceAlerts": [ { "resource": "...", "level": "critical", "available": 0, "message": "..." } ]
  }
}
```

### GET `/api/dashboard/booker` — `booker` role

```json
{
  "success": true,
  "data": {
    "upcomingEvents": [ { "_id": "...", "name": "...", "startDate": "...", "endDate": "...", "status": "pending", "venue": "AVR" } ],
    "pendingBookings": 1,
    "approvedBookings": 2,
    "rejectedBookings": 0,
    "recentActivity": [ { "type": "booking", "id": "...", "label": "Booking for Tech Summit", "status": "Pending", "date": "..." } ]
  }
}
```

Scope: **own** events/bookings only. `403` for management, `401` without token.

### GET `/api/dashboard/management` — `management` role`

```json
{
  "success": true,
  "data": {
    "totalEvents": 8,
    "pendingRequests": 1,
    "approvedEvents": 2,
    "upcomingEvents": 3,
    "totalResources": 5,
    "totalVenues": 2,
    "activeConflicts": 2,
    "resourceUtilization": { "average": 42, "resources": [ { "_id": "...", "name": "Projector", "utilization": 66 } ] }
  }
}
```

`activeConflicts` counts venue overlaps, same-organization schedule overlaps and
resource shortages across all non-cancelled events. `403` for bookers.

---

## Error handling

All errors go through a central handler:

- Mongoose `CastError` (bad ObjectId) → `400`
- Mongoose duplicate key (`code 11000`) → `409`
- `DocumentNotFoundError` → `404`
- Model validation → `400` with the validation message
- Everything else → `500` (stack only in development; production returns a
  generic message)

## Testing

```bash
npm test          # Jest + Supertest, uses eventory_test database (--runInBand)
```

Suites cover auth, role authorization, event ownership, bookings, the approval
workflow, conflict detection, dashboards, CRUD/business rules, DB integration and
error handling.
