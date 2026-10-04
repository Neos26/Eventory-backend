# Eventory Backend

Backend API for **Eventory**, an Event Resource Management System.

- Backend repo: `Neos26/Eventory-backend` (this repo)
- Frontend repo: `Neos26/Eventory-frontend`

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose ODM
- **Language:** JavaScript

## Project Structure

```
Eventory-backend/          (repo root)
├── API.md                  # Full endpoint reference
└── server/
    ├── app.js               # Express app: JSON, CORS, routes, 404, error handler
    ├── server.js            # Loads .env, connects to MongoDB, starts listening
    ├── seed.js              # Idempotent demo-data seeder (npm run seed)
    ├── package.json
    ├── .env.example         # Copy to .env and adjust
    ├── config/
    │   └── database.js      # Mongoose connection helper
    ├── models/              # Mongoose schemas
    ├── controllers/         # Request handlers
    ├── routes/              # Route definitions
    ├── middleware/          # Auth, 404 + global error handler
    ├── utils/               # Password hashing, JWT, shared helpers
    └── tests/               # Jest integration tests (npm test)
```

## Getting Started

### Prerequisites

- Node.js 18+ (developed on Node 24)
- MongoDB running locally

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

| Variable     | Default                              | Purpose                        |
| ------------ | ------------------------------------ | ------------------------------ |
| `PORT`       | `5000`                               | API port                       |
| `MONGODB_URI`| `mongodb://127.0.0.1:27017/eventory` | MongoDB connection string      |
| `CLIENT_URL` | `http://localhost:5173`              | React origin allowed by CORS   |

### 3. Run the server

```bash
npm run dev   # nodemon, restarts on file changes
npm start     # plain node
```

### 4. Seed demo data (optional)

```bash
npm run seed
```

Idempotent — safe to re-run. Creates demo users (password `secret123`),
organizations, venues, a resource catalog, ~44 events with venue/schedule
conflicts, resource shortages and booking requests, so every list, conflict
and readiness screen has data.

### 5. Run the tests

```bash
npm test      # Jest integration tests against the eventory_test database
```

## API

Route modules under `/api`: `auth`, `bookings`, `dashboard`, `events`,
`organizations`, `reservations`, `resources`, `statistics`, `utilization`,
`venues`, `health`. The full endpoint reference lives in [`API.md`](API.md).

### `GET /api/health`

```json
{
  "success": true,
  "status": "ok",
  "message": "Eventory API is running",
  "database": "connected",
  "timestamp": "2026-09-29T14:49:19.603Z"
}
```

Unknown routes return `404` and errors are handled by a global error-handling middleware.

## Data Models

| Model                 | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `User`                | Book or management account (role: `booker` / `management`)         |
| `Organization`        | Company / event planner that owns events                           |
| `Event`               | Central entity — belongs to an organization, optional venue        |
| `Venue`               | Physical location that can host events                             |
| `Resource`            | Reusable item (chairs, projectors, catering sets, ...)             |
| `ResourceRequirement` | "Event needs N units of resource X on date Y"                      |
| `ResourceReservation` | Actual booking of resource quantity for a time period              |
| `Booking`             | Booker's request to approve/reject an event's venue and resources  |

Relationships: `User` creates `Event`s and submits `Booking`s;
`Organization` → `Event` → `ResourceRequirement` → `ResourceReservation`,
with `Venue` and `Resource` referenced where needed.
