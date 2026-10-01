const express = require('express');
const {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventRequirements,
  createEventRequirement,
  updateEventRequirement,
  deleteEventRequirement,
  getEventConflicts,
  getEventReadiness,
} = require('../controllers/eventController');
const { authenticate, attachUser } = require('../middleware/auth');

const router = express.Router();

router.get('/', attachUser, getEvents);
router.get('/:id/conflicts', attachUser, getEventConflicts);
router.get('/:id/readiness', attachUser, getEventReadiness);
router.get('/:eventId/requirements', attachUser, getEventRequirements);
router.get('/:id', attachUser, getEvent);
router.post('/', authenticate, createEvent);
router.put('/:id', authenticate, updateEvent);
router.delete('/:id', authenticate, deleteEvent);

router.post('/:eventId/requirements', authenticate, createEventRequirement);
router.put('/:eventId/requirements/:requirementId', authenticate, updateEventRequirement);
router.delete('/:eventId/requirements/:requirementId', authenticate, deleteEventRequirement);

module.exports = router;
