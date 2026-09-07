const express = require("express");
const Disaster = require("../models/disaster");
const Sos = require("../models/sos");
const Alert = require("../models/alert");
const { buildAlerts, createAlert } = require("../services/alerts");
const { analyzeAlertWithAI } = require("../services/alertAI");

const router = express.Router();

// =====================================================
// GET ALL ALERTS
// =====================================================
// All three alert sources are manageable from the Alerts UI:
// 1. Alert collection       -> AI/system alerts
// 2. Disaster collection   -> chatbot/reported disaster alerts
// 3. SOS collection        -> emergency SOS alerts
//
// This fixes the previous issue where Disaster + SOS records
// were returned as isManaged:false, so the frontend hid the
// Acknowledge/Resolve buttons.
// =====================================================

router.get("/", async (req, res) => {
  try {
    const [savedAlerts, disasters, sosSignals] =
      await Promise.all([
        Alert.find().sort({ createdAt: -1 }),
        Disaster.find().sort({ createdAt: -1 }),
        Sos.find().sort({ createdAt: -1 }),
      ]);

    // ---------------------------------------------
    // MongoDB Alert collection
    // ---------------------------------------------
    const managedAlerts = savedAlerts.map((alert) => ({
      id: String(alert._id),
      type: alert.type,
      title: alert.title,
      message: alert.description || "",
      description: alert.description || "",
      severity: String(alert.severity || "LOW").toUpperCase(),
      location: alert.location?.name || "",
      latitude: alert.location?.latitude ?? null,
      longitude: alert.location?.longitude ?? null,
      status: String(alert.status || "ACTIVE").toUpperCase(),
      createdAt: alert.createdAt,
      source: alert.source || "Alert System",
      metadata: alert.metadata,
      resourceType: "Alert",
      isManaged: true,
    }));

    // ---------------------------------------------
    // Disaster collection
    // ---------------------------------------------
    const disasterAlerts = disasters.map((disaster) => ({
      id: String(disaster._id),
      type: disaster.type || "Disaster",
      title:
        disaster.description ||
        `${disaster.type || "Disaster"} Incident`,
      message:
        disaster.description ||
        `${disaster.severity || "UNKNOWN"} ${
          disaster.type || "Disaster"
        } emergency reported at ${
          disaster.location || "Unknown location"
        }.`,
      description:
        disaster.description ||
        `${disaster.severity || "UNKNOWN"} ${
          disaster.type || "Disaster"
        } emergency reported at ${
          disaster.location || "Unknown location"
        }.`,
      severity: String(
        disaster.severity || "MEDIUM"
      ).toUpperCase(),
      location: disaster.location || "",
      latitude:
        disaster.latitude !== undefined
          ? disaster.latitude
          : null,
      longitude:
        disaster.longitude !== undefined
          ? disaster.longitude
          : null,
      status: String(
        disaster.status || "Active"
      ).toUpperCase(),
      createdAt: disaster.createdAt,
      source:
        disaster.source ||
        "Disaster System",
      resourceType: "Disaster",
      isManaged: true,
    }));

    // ---------------------------------------------
    // SOS collection
    // ---------------------------------------------
    const sosAlerts = sosSignals.map((sos) => ({
      id: String(sos._id),
      type: "SOS Emergency",
      title:
        sos.notes ||
        "SOS Distress Signal",
      message:
        sos.notes ||
        `${sos.priority || "High"} priority SOS distress signal from ${
          sos.location || "Unknown location"
        }.`,
      description:
        sos.notes ||
        `${sos.priority || "High"} priority SOS distress signal from ${
          sos.location || "Unknown location"
        }.`,
      severity: String(
        sos.priority || "High"
      ).toUpperCase(),
      location: sos.location || "",
      status: String(
        sos.status || "Active"
      ).toUpperCase(),
      latitude:
        sos.latitude !== undefined
          ? sos.latitude
          : null,
      longitude:
        sos.longitude !== undefined
          ? sos.longitude
          : null,
      createdAt: sos.createdAt,
      source: "SOS System",
      resourceType: "SOS",
      isManaged: true,
    }));

    const alerts = [
      ...managedAlerts,
      ...disasterAlerts,
      ...sosAlerts,
    ];

    alerts.sort(
      (a, b) =>
        new Date(b.createdAt) -
        new Date(a.createdAt)
    );

    return res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts,
    });
  } catch (error) {
    console.error(
      "Fetch alerts error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch alerts",
      error: error.message,
    });
  }
});

// =====================================================
// POST CREATE NORMAL/SYSTEM ALERT
// =====================================================

router.post("/", async (req, res) => {
  try {
    const {
      type,
      title,
      description = "",
      severity,
      source = "",
      location = {},
      metadata = {},
    } = req.body;

    if (!type || !title || !severity) {
      return res.status(400).json({
        success: false,
        message:
          "type, title and severity are required",
      });
    }

    const alert = await createAlert({
      type,
      title,
      description,
      severity,
      source,
      location,
      metadata,
    });

    return res.status(201).json({
      success: true,
      message: "Alert created successfully",
      data: alert,
    });
  } catch (error) {
    console.error(
      "Create alert error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create alert",
      error: error.message,
    });
  }
});

// =====================================================
// POST GROQ AI ALERT
// =====================================================

router.post("/ai", async (req, res) => {
  try {
    const { event } = req.body;

    if (!event) {
      return res.status(400).json({
        success: false,
        message: "event is required",
      });
    }

    const aiResult =
      await analyzeAlertWithAI(event);

    const alert = await createAlert({
      type: aiResult.type,
      title: aiResult.title,
      description: aiResult.description,
      severity: aiResult.severity,
      source: "Groq Alert AI",
      location: event.location || {},
      metadata: {
        riskScore: aiResult.riskScore,
        confidence: aiResult.confidence,
        aiGenerated: true,
      },
    });

    return res.status(201).json({
      success: true,
      message:
        "AI alert generated successfully",
      data: alert,
      aiAnalysis: aiResult,
    });
  } catch (error) {
    console.error(
      "AI alert error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to generate AI alert",
      error: error.message,
    });
  }
});

// =====================================================
// PATCH ACKNOWLEDGE ALERT
// =====================================================
// Tries Alert first, then Disaster, then SOS.
// This allows alerts created by the chatbot/disaster
// reporting flow to be acknowledged from the same UI.

router.patch(
  "/:id/acknowledge",
  async (req, res) => {
    try {
      const id = req.params.id;

      // 1. Alert collection
      let updated = await Alert.findByIdAndUpdate(
        id,
        {
          status: "ACKNOWLEDGED",
          acknowledgedAt: new Date(),
        },
        {
          new: true,
          runValidators: true,
        }
      );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "Alert acknowledged successfully",
          data: updated,
          resourceType: "Alert",
        });
      }

      // 2. Disaster collection
      updated =
        await Disaster.findByIdAndUpdate(
          id,
          {
            status: "Acknowledged",
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "Disaster alert acknowledged successfully",
          data: updated,
          resourceType: "Disaster",
        });
      }

      // 3. SOS collection
      updated =
        await Sos.findByIdAndUpdate(
          id,
          {
            status: "Acknowledged",
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "SOS alert acknowledged successfully",
          data: updated,
          resourceType: "SOS",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    } catch (error) {
      console.error(
        "Acknowledge alert error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to acknowledge alert",
        error: error.message,
      });
    }
  }
);

// =====================================================
// PATCH RESOLVE ALERT
// =====================================================
// Tries Alert first, then Disaster, then SOS.
// Resolved records stay in history but disappear from
// dashboard Recent Alerts because the frontend filters
// RESOLVED alerts there.

router.patch(
  "/:id/resolve",
  async (req, res) => {
    try {
      const id = req.params.id;

      // 1. Alert collection
      let updated = await Alert.findByIdAndUpdate(
        id,
        {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
        {
          new: true,
          runValidators: true,
        }
      );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "Alert resolved successfully",
          data: updated,
          resourceType: "Alert",
        });
      }

      // 2. Disaster collection
      updated =
        await Disaster.findByIdAndUpdate(
          id,
          {
            status: "Resolved",
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "Disaster alert resolved successfully",
          data: updated,
          resourceType: "Disaster",
        });
      }

      // 3. SOS collection
      updated =
        await Sos.findByIdAndUpdate(
          id,
          {
            status: "Resolved",
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (updated) {
        return res.status(200).json({
          success: true,
          message:
            "SOS alert resolved successfully",
          data: updated,
          resourceType: "SOS",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    } catch (error) {
      console.error(
        "Resolve alert error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to resolve alert",
        error: error.message,
      });
    }
  }
);

// =====================================================
// DELETE ALERT
// =====================================================
// Keeps the existing dashboard delete action useful
// for all three alert sources.

router.delete(
  "/:id",
  async (req, res) => {
    try {
      const id = req.params.id;

      let deleted =
        await Alert.findByIdAndDelete(id);

      if (deleted) {
        return res.status(200).json({
          success: true,
          message:
            "Alert deleted successfully",
          data: deleted,
          resourceType: "Alert",
        });
      }

      deleted =
        await Disaster.findByIdAndDelete(id);

      if (deleted) {
        return res.status(200).json({
          success: true,
          message:
            "Disaster alert deleted successfully",
          data: deleted,
          resourceType: "Disaster",
        });
      }

      deleted =
        await Sos.findByIdAndDelete(id);

      if (deleted) {
        return res.status(200).json({
          success: true,
          message:
            "SOS alert deleted successfully",
          data: deleted,
          resourceType: "SOS",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    } catch (error) {
      console.error(
        "Delete alert error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to delete alert",
        error: error.message,
      });
    }
  }
);

module.exports = router;