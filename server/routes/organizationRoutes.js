const express = require('express');
const {
  getOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} = require('../controllers/organizationController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', getOrganizations);
router.get('/:id', getOrganization);
router.post('/', authenticate, authorizeRole('management'), createOrganization);
router.put('/:id', authenticate, authorizeRole('management'), updateOrganization);
router.delete('/:id', authenticate, authorizeRole('management'), deleteOrganization);

module.exports = router;
