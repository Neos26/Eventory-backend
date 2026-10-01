const mongoose = require('mongoose');

// A User belongs to the system with one of the two allowed roles.
// organizationId links the user to an Organization (optional so accounts
// can be created before an organization exists).
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 200,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 200,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // never returned unless explicitly selected
    },
    role: {
      type: String,
      enum: {
        values: ['booker', 'management'],
        message: 'Role must be either booker or management',
      },
      default: 'booker',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
