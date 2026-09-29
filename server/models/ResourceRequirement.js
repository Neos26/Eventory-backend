const mongoose = require('mongoose');

// "What an event needs": a line item asking for N units of a resource
// on a given date. Reservations fulfil these requirements.
const resourceRequirementSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: true,
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: 1,
    },
    requiredDate: {
      type: Date,
      required: [true, 'Required date is required'],
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'partially_reserved', 'reserved', 'fulfilled', 'cancelled'],
      default: 'pending',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResourceRequirement', resourceRequirementSchema);
