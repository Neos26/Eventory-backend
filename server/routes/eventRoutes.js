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

const router = express.Router();

router.get('/', getEvents);
router.get('/:id/conflicts', getEventConflicts);
router.get('/:id/readiness', getEventReadiness);
router.get('/:eventId/requirements', getEventRequirements);
router.get('/:id', getEvent);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

router.post('/:eventId/requirements', createEventRequirement);
router.put('/:eventId/requirements/:requirementId', updateEventRequirement);
router.delete('/:eventId/requirements/:requirementId', deleteEventRequirement);

module.exports = router;
