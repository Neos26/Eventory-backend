const Organization = require('../models/Organization');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

// GET /api/organizations
const getOrganizations = asyncHandler(async (req, res) => {
  const organizations = await Organization.find().sort({ createdAt: -1 });
  res.json({ success: true, count: organizations.length, data: organizations });
});

// GET /api/organizations/:id
const getOrganization = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Organization');
  const organization = await Organization.findById(req.params.id);
  if (!organization) throw new HttpError(404, 'Organization not found');
  res.json({ success: true, data: organization });
});

// POST /api/organizations
const createOrganization = asyncHandler(async (req, res) => {
  const organization = await Organization.create(req.body);
  res.status(201).json({ success: true, data: organization });
});

// PUT /api/organizations/:id
const updateOrganization = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Organization');
  const organization = await Organization.findById(req.params.id);
  if (!organization) throw new HttpError(404, 'Organization not found');

  organization.set(req.body);
  await organization.save(); // runs model validators
  res.json({ success: true, data: organization });
});

// DELETE /api/organizations/:id
const deleteOrganization = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Organization');
  const organization = await Organization.findByIdAndDelete(req.params.id);
  if (!organization) throw new HttpError(404, 'Organization not found');
  res.json({ success: true, message: 'Organization deleted', data: organization });
});

module.exports = {
  getOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
};
