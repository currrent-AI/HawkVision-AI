const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const {
  analyzeDroneVideo,
  startLiveSession,
  stopLiveSession,
  subscribeToSession,
  unsubscribeFromSession,
  startDroneFeed,
} = require("../services/droneDetection");

const router = express.Router();

// ============================================================
// UPLOAD DIRECTORY
// ============================================================

const uploadDir = path.join(__dirname, "../uploads/drone");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true,
  });
}

// ============================================================
// STORAGE
// ============================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);

    const safeName =
      path
        .basename(file.originalname, extension)
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .substring(0, 80) || "drone-video";

    cb(
      null,
      `${Date.now()}-${safeName}${extension.toLowerCase()}`
    );
  },
});

// ============================================================
// ALLOWED VIDEO TYPES
// ============================================================

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
];

// ============================================================
// MULTER
// ============================================================

const upload = multer({
  storage,

  limits: {
    fileSize: 500 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only MP4, WebM, MOV and M4V video files are allowed"
        )
      );
    }
  },
});

// ============================================================
// SAFE VIDEO RESOLUTION
// ============================================================

function resolveSafeVideo(fileName) {
  if (!fileName || typeof fileName !== "string") {
    return null;
  }

  const base = path.basename(fileName);

  if (!base || base !== fileName) {
    return null;
  }

  const full = path.resolve(uploadDir, base);
  const root = path.resolve(uploadDir);

  if (
    !full.startsWith(root + path.sep) &&
    full !== root
  ) {
    return null;
  }

  if (
    !fs.existsSync(full) ||
    !fs.statSync(full).isFile()
  ) {
    return null;
  }

  return full;
}

// ============================================================
// HEALTH CHECK
// ============================================================

router.get("/status", (req, res) => {
  const droneConfigured =
    !!process.env.DRONE_STREAM_URL;

  return res.status(200).json({
    success: true,

    droneAI: {
      status: "ready",
      engine: "YOLO",
      detection: true,
      tracking: true,
      confidence: true,
      riskLevels: true,
    },

    recordedVideo: {
      enabled: true,
    },

    liveDrone: {
      enabled: droneConfigured,
      source: droneConfigured
        ? "DRONE_NETWORK_STREAM"
        : "NOT_CONFIGURED",
    },
  });
});

// ============================================================
// UPLOAD DRONE VIDEO
// ============================================================

router.post(
  "/upload",
  upload.single("video"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload a drone video",
        });
      }

      return res.status(201).json({
        success: true,

        message:
          "Drone video uploaded successfully",

        data: {
          fileName: req.file.filename,

          originalName:
            req.file.originalname,

          size: req.file.size,

          mimeType:
            req.file.mimetype,

          url:
            `/api/drone/videos/${encodeURIComponent(
              req.file.filename
            )}`,
        },
      });
    } catch (error) {
      console.error(
        "Drone upload error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Drone video upload failed",
        error: error.message,
      });
    }
  }
);

// ============================================================
// LIST RECORDED DRONE VIDEOS
// ============================================================

router.get("/videos", (req, res) => {
  try {
    const files = fs
      .readdirSync(uploadDir)
      .filter((name) => {
        const full = path.join(
          uploadDir,
          name
        );

        return (
          fs.existsSync(full) &&
          fs.statSync(full).isFile() &&
          /\.(mp4|webm|mov|m4v)$/i.test(name)
        );
      })
      .map((name) => {
        const full = path.join(
          uploadDir,
          name
        );

        const stat = fs.statSync(full);

        let mimeType = "video/mp4";

        if (name.toLowerCase().endsWith(".webm")) {
          mimeType = "video/webm";
        }

        if (name.toLowerCase().endsWith(".mov")) {
          mimeType = "video/quicktime";
        }

        if (name.toLowerCase().endsWith(".m4v")) {
          mimeType = "video/x-m4v";
        }

        return {
          fileName: name,

          size: stat.size,

          mimeType,

          uploadedAt:
            stat.mtime.toISOString(),

          url:
            `/api/drone/videos/${encodeURIComponent(
              name
            )}`,
        };
      })
      .sort((a, b) =>
        b.uploadedAt.localeCompare(
          a.uploadedAt
        )
      );

    return res.status(200).json({
      success: true,
      count: files.length,
      data: files,
    });
  } catch (error) {
    console.error(
      "Video list error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to list drone videos",
      error: error.message,
    });
  }
});

// ============================================================
// SERVE VICTIM EVIDENCE IMAGE
// Evidence is stored inside each drone video's evidence folder.
// ============================================================

router.get("/evidence/:fileName", (req, res) => {
  const requested = path.basename(req.params.fileName || "");

  if (!requested || requested !== req.params.fileName) {
    return res.status(400).json({
      success: false,
      message: "Invalid evidence filename",
    });
  }

  try {
    let foundPath = null;
    const videoFiles = fs.readdirSync(uploadDir, { withFileTypes: true });

    for (const entry of videoFiles) {
      if (!entry.isFile()) continue;

      const videoBase = path.join(uploadDir, entry.name);
      const evidenceDir = path.join(uploadDir, "evidence", entry.name);

      // Current Python implementation stores evidence at:
      // uploads/drone/<video-name>/evidence/<image>.jpg
      const nestedDir = path.join(videoBase, "evidence");
      const candidates = [nestedDir, evidenceDir];

      for (const dir of candidates) {
        const candidate = path.join(dir, requested);
        if (candidate.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          foundPath = candidate;
          break;
        }
      }

      if (foundPath) break;
    }

    // Fallback: recursively search only inside the drone upload directory.
    if (!foundPath) {
      const stack = [uploadDir];
      while (stack.length && !foundPath) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(fullPath);
          } else if (entry.isFile() && entry.name === requested) {
            foundPath = fullPath;
            break;
          }
        }
      }
    }

    if (!foundPath) {
      return res.status(404).json({
        success: false,
        message: "Evidence image not found",
      });
    }

    res.type(path.extname(foundPath) || ".jpg");
    return res.sendFile(path.resolve(foundPath));
  } catch (error) {
    console.error("Evidence image error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load evidence image",
    });
  }
});

// ============================================================
// SERVE RECORDED VIDEO
// Supports browser seeking with HTTP Range
// ============================================================

router.get(
  "/videos/:fileName",
  (req, res) => {
    const videoPath =
      resolveSafeVideo(
        req.params.fileName
      );

    if (!videoPath) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    const ext =
      path
        .extname(videoPath)
        .toLowerCase();

    let contentType = "video/mp4";

    if (ext === ".webm") {
      contentType = "video/webm";
    }

    if (ext === ".mov") {
      contentType = "video/quicktime";
    }

    if (ext === ".m4v") {
      contentType = "video/x-m4v";
    }

    const stat =
      fs.statSync(videoPath);

    const fileSize = stat.size;

    const range =
      req.headers.range;

    // --------------------------------------------------------
    // RANGE REQUEST
    // --------------------------------------------------------

    if (range) {
      const parts =
        range
          .replace(/bytes=/, "")
          .split("-");

      const start =
        parseInt(parts[0], 10);

      const end =
        parts[1]
          ? parseInt(parts[1], 10)
          : fileSize - 1;

      if (
        Number.isNaN(start) ||
        start >= fileSize ||
        end >= fileSize ||
        start > end
      ) {
        res.setHeader(
          "Content-Range",
          `bytes */${fileSize}`
        );

        return res.status(416).end();
      }

      const chunkSize =
        end - start + 1;

      const stream =
        fs.createReadStream(
          videoPath,
          {
            start,
            end,
          }
        );

      res.writeHead(206, {
        "Content-Range":
          `bytes ${start}-${end}/${fileSize}`,

        "Accept-Ranges":
          "bytes",

        "Content-Length":
          chunkSize,

        "Content-Type":
          contentType,

        "Cache-Control":
          "no-cache",
      });

      return stream.pipe(res);
    }

    // --------------------------------------------------------
    // NORMAL REQUEST
    // --------------------------------------------------------

    res.writeHead(200, {
      "Content-Length":
        fileSize,

      "Content-Type":
        contentType,

      "Accept-Ranges":
        "bytes",

      "Cache-Control":
        "no-cache",
    });

    return fs
      .createReadStream(videoPath)
      .pipe(res);
  }
);

// ============================================================
// BATCH ANALYSIS
//
// Used when user wants complete analysis.
// ============================================================

router.post(
  "/analyze",
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            "Please upload a drone video",
        });
      }

      console.log(
        `[drone] Starting batch analysis: ${req.file.filename}`
      );

      const result =
        await analyzeDroneVideo(
          req.file.path
        );

      return res.status(200).json({
        success: true,

        message:
          "Drone video analysis completed",

        data: result,
      });
    } catch (error) {
      console.error(
        "Drone analysis error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Drone video analysis failed",

        error: error.message,
      });
    }
  }
);

// ============================================================
// RECORDED VIDEO → REAL-TIME YOLO
//
// This does NOT use laptop camera.
//
// The uploaded drone video is passed frame-by-frame
// to the same YOLO engine.
// ============================================================

router.post(
  "/live/start",
  (req, res) => {
    try {
      const {
        fileName,
      } = req.body || {};

      if (
        !fileName ||
        typeof fileName !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "fileName is required",
        });
      }

      const videoPath =
        resolveSafeVideo(
          fileName
        );

      if (!videoPath) {
        return res.status(404).json({
          success: false,
          message:
            "Recorded drone video not found",
        });
      }

      const sessionId =
        startLiveSession(
          videoPath
        );

      return res.status(200).json({
        success: true,

        mode:
          "RECORDED_DRONE_AI",

        sessionId,

        message:
          "Real-time YOLO detection started on recorded drone footage",
      });
    } catch (error) {
      console.error(
        "Recorded live start error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Failed to start recorded drone AI",

        error: error.message,
      });
    }
  }
);

// ============================================================
// ACTUAL DRONE NETWORK STREAM
//
// IMPORTANT:
// This connects to DRONE_STREAM_URL.
// It NEVER opens navigator.mediaDevices camera.
// ============================================================

router.post(
  "/live/drone/start",
  (req, res) => {
    try {
      const droneUrl =
        process.env.DRONE_STREAM_URL;

      if (!droneUrl) {
        return res.status(503).json({
          success: false,

          message:
            "Drone stream is not configured. Add DRONE_STREAM_URL to server environment.",
        });
      }

      console.log(
        `[drone-live] Connecting to: ${droneUrl}`
      );

      const sessionId =
        startLiveSession(
          droneUrl
        );

      return res.status(200).json({
        success: true,

        mode:
          "LIVE_DRONE_NETWORK",

        sessionId,

        source:
          "DRONE_NETWORK_STREAM",

        message:
          "Live drone AI detection started",
      });
    } catch (error) {
      console.error(
        "Drone live start error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Failed to connect to drone stream",

        error: error.message,
      });
    }
  }
);

// ============================================================
// LIVE DRONE VIDEO FEED
//
// Browser gets MJPEG from backend.
// No laptop webcam.
// ============================================================

router.get(
  "/live/drone/feed",
  (req, res) => {
    try {
      const droneUrl =
        process.env.DRONE_STREAM_URL;

      if (!droneUrl) {
        return res.status(503).json({
          success: false,

          message:
            "DRONE_STREAM_URL is not configured.",
        });
      }

      startDroneFeed(res);
    } catch (error) {
      console.error(
        "Drone feed error:",
        error
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,

          message:
            "Failed to start drone video feed",

          error: error.message,
        });
      }

      res.end();
    }
  }
);

// ============================================================
// SSE DETECTION STREAM
//
// Frontend connects here:
//
// /api/drone/live/{sessionId}/stream
//
// Events contain YOLO detections.
// ============================================================

router.get(
  "/live/:sessionId/stream",
  (req, res) => {
    const {
      sessionId,
    } = req.params;

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.setHeader(
      "X-Accel-Buffering",
      "no"
    );

    res.flushHeaders();

    const sendFn =
      (event) => {
        try {
          res.write(
            `data: ${JSON.stringify(
              event
            )}\n\n`
          );
        } catch {
          unsubscribeFromSession(
            sessionId,
            sendFn
          );
        }
      };

    const subscribed =
      subscribeToSession(
        sessionId,
        sendFn
      );

    if (!subscribed) {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            "Detection session not found or already finished",
        })}\n\n`
      );

      return res.end();
    }

    // Initial connection event
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        sessionId,
      })}\n\n`
    );

    // Heartbeat
    const heartbeat =
      setInterval(() => {
        try {
          res.write(
            ": heartbeat\n\n"
          );
        } catch {
          clearInterval(
            heartbeat
          );
        }
      }, 15000);

    req.on(
      "close",
      () => {
        clearInterval(
          heartbeat
        );

        unsubscribeFromSession(
          sessionId,
          sendFn
        );
      }
    );
  }
);

// ============================================================
// STOP LIVE SESSION
// ============================================================

router.delete(
  "/live/:sessionId",
  (req, res) => {
    try {
      stopLiveSession(
        req.params.sessionId
      );

      return res.status(200).json({
        success: true,

        message:
          "Drone AI session stopped",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================
// MULTER / ROUTE ERROR HANDLER
// ============================================================

router.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Video upload failed",

        error:
          error.message,
      });
    }

    if (error) {
      console.error(
        "Drone route error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error.message,
      });
    }

    next();
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;