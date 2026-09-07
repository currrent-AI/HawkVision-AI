const mongoose = require("mongoose");

const disasterSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["Flood", "Earthquake", "Landslide", "Storm", "Other"],
    },

    location: {
      type: String,
      required: true,
    },

    severity: {
      type: String,
      required: true,
      enum: ["Low", "Medium", "High", "Critical"],
    },

    description: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["Active", "Acknowledged", "Resolved"],
      default: "Active",
    },

    latitude: {
      type: Number,
    },

    longitude: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Disaster", disasterSchema);