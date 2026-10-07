const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

// GET /api/resources
const getResources = asyncHandler(async (req, res) => {
  const resources = await Resource.find().sort({ createdAt: -1 });
  res.json({ success: true, count: resources.length, data: resources });
});

// GET /api/resources/:id
const getResource = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Resource');
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new HttpError(404, 'Resource not found');
  res.json({ success: true, data: resource });
});

// POST /api/resources
const createResource = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  // New resources start fully available unless told otherwise.
  if (body.quantityAvailable === undefined && body.quantityTotal !== undefined) {
    body.quantityAvailable = body.quantityTotal;
  }
  const resource = await Resource.create(body);
  res.status(201).json({ success: true, data: resource });
});

// PUT /api/resources/:id
const updateResource = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Resource');
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new HttpError(404, 'Resource not found');

  // Lowering the total below what active reservations already hold would make
  // available stock negative; the shortfall must be freed first.
  if (req.body.quantityTotal !== undefined && req.body.quantityTotal !== null) {
    const nextTotal = Number(req.body.quantityTotal);
    if (Number.isFinite(nextTotal) && nextTotal < resource.quantityTotal) {
      const active = await ResourceReservation.find({
        resource: resource._id,
        status: { $in: ['reserved', 'issued'] },
      }).select('quantity');
      const reserved = active.reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (nextTotal < reserved) {
        throw new HttpError(
          400,
          `Total quantity cannot be reduced to ${nextTotal} — ${reserved} units are held by active reservations. Cancel or reduce reservations first.`,
        );
      }
    }
  }

  resource.set(req.body);
  await resource.save();
  res.json({ success: true, data: resource });
});

// DELETE /api/resources/:id
const deleteResource = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Resource');
  const resource = await Resource.findByIdAndDelete(req.params.id);
  if (!resource) throw new HttpError(404, 'Resource not found');

  // Requirements and reservations that reference a deleted resource would
  // otherwise linger as unfillable entries ("Unknown resource" shortages).
  await Promise.all([
    ResourceRequirement.deleteMany({ resource: resource._id }),
    ResourceReservation.deleteMany({ resource: resource._id }),
  ]);

  res.json({ success: true, message: 'Resource deleted', data: resource });
});

// GET /api/resources/:id/availability
// Available = total quantity - quantity currently reserved (active reservations).
const getResourceAvailability = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Resource');
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new HttpError(404, 'Resource not found');

  const active = await ResourceReservation.find({
    resource: resource._id,
    status: { $in: ['reserved', 'issued'] },
  }).select('quantity');

  const reserved = active.reduce((sum, reservation) => sum + reservation.quantity, 0);
  // Over-reserved stock (legacy data) reports zero available, never negative.
  const available = Math.max(0, resource.quantityTotal - reserved);

  res.json({
    success: true,
    data: {
      resource: { id: resource._id, name: resource.name, unit: resource.unit },
      total: resource.quantityTotal,
      reserved,
      available,
      activeReservations: active.length,
    },
  });
});

module.exports = {
  getResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  getResourceAvailability,
};
