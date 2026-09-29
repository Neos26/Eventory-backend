const mongoose = require('mongoose');

// "The actual booking": quantity of a resource allocated to an event
// for a period of time.
const resourceReservationSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    requirement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResourceRequirement',
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
    reservedFrom: {
      type: Date,
      required: [true, 'Reservation start date is required'],
    },
    reservedUntil: {
      type: Date,
      required: [true, 'Reservation end date is required'],
    },
    status: {
      type: String,
      enum: ['reserved', 'issued', 'returned', 'cancelled'],
      default: 'reserved',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

// A reservation period must make sense chronologically.
resourceReservationSchema.pre('validate', function (next) {
  if (this.reservedFrom && this.reservedUntil && this.reservedUntil < this.reservedFrom) {
    this.invalidate('reservedUntil', 'Reserved until must be after reserved from');
  }
  next();
});

module.exports = mongoose.model('ResourceReservation', resourceReservationSchema);
