const mongoose = require('mongoose');

// A Resource is a reusable item the organization owns or rents out
// (chairs, projectors, speakers, catering sets, ...).
const resourceSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    name: {
      type: String,
      required: [true, 'Resource name is required'],
      trim: true,
      maxlength: 200,
    },
    category: {
      type: String,
      trim: true,
      enum: {
        values: ['furniture', 'audio_visual', 'decoration', 'catering', 'IT', 'transport', 'other'],
        message: '{VALUE} is not a supported resource category',
      },
      default: 'other',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    quantityTotal: {
      type: Number,
      required: [true, 'Total quantity is required'],
      min: 0,
      default: 0,
    },
    quantityAvailable: {
      type: Number,
      min: 0,
      default: 0,
    },
    unit: {
      type: String,
      trim: true,
      default: 'unit', // e.g. unit, set, hour, kg
    },
    costPerUnit: {
      type: Number,
      min: 0,
      default: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Available stock can never exceed the total stock.
resourceSchema.pre('validate', function (next) {
  if (
    typeof this.quantityTotal === 'number' &&
    typeof this.quantityAvailable === 'number' &&
    this.quantityAvailable > this.quantityTotal
  ) {
    this.invalidate('quantityAvailable', 'Available quantity cannot exceed total quantity');
  }
  next();
});

module.exports = mongoose.model('Resource', resourceSchema);
