const mongoose = require('mongoose');

// A Venue is a physical location that can host events.
const venueSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    name: {
      type: String,
      required: [true, 'Venue name is required'],
      trim: true,
      maxlength: 200,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    capacity: {
      type: Number,
      min: 0,
      default: 0,
    },
    venueType: {
      type: String,
      enum: ['indoor', 'outdoor', 'hybrid'],
      default: 'indoor',
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Venue', venueSchema);
