const express = require('express');
const {
  getResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  getResourceAvailability,
} = require('../controllers/resourceController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', getResources);
router.get('/:id/availability', getResourceAvailability);
router.get('/:id', getResource);
router.post('/', authenticate, authorizeRole('management'), createResource);
router.put('/:id', authenticate, authorizeRole('management'), updateResource);
router.delete('/:id', authenticate, authorizeRole('management'), deleteResource);

module.exports = router;
