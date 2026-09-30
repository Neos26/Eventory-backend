const express = require('express');
const {
  getResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  getResourceAvailability,
} = require('../controllers/resourceController');

const router = express.Router();

router.get('/', getResources);
router.get('/:id/availability', getResourceAvailability);
router.get('/:id', getResource);
router.post('/', createResource);
router.put('/:id', updateResource);
router.delete('/:id', deleteResource);

module.exports = router;
