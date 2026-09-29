const mongoose = require('mongoose');

// An Event is the central entity: it belongs to an organization and may
// be assigned a venue. Resource requirements and reservations hang off it.
const eventSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Event name is required'],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    category: {
      type: String,
      trim: true,
      enum: {
        values: ['conference', 'workshop', 'concert', 'exhibition', 'sports', 'corporate', 'other'],
        message: '{VALUE} is not a supported event category',
      },
      default: 'other',
    },
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    expectedAttendees: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ['draft', 'planned', 'ongoing', 'completed', 'cancelled'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

// End date can never be before the start date.
eventSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    this.invalidate('endDate', 'End date must be after the start date');
  }
  next();
});

module.exports = mongoose.model('Event', eventSchema);
