const mongoose = require('mongoose');

// A Booking is a booker's request to lock an event's venue and resources.
// Management reviews each request: approve (creates the reservations)
// or reject (with a reason).
const bookingSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    bookerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed'],
      default: 'Pending',
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ bookerId: 1, status: 1 });
bookingSchema.index({ eventId: 1, status: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
