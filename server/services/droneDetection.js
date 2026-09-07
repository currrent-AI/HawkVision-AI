const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ============================================================
// PYTHON
// ============================================================

const PYTHON_PATH =
  process.env.PYTHON_PATH ||
  "C:/Users/lenovo/AppData/Local/Programs/Python/Python313/python.exe";

// ============================================================
// YOLO26m
// ============================================================

const MODEL_PATH =
  process.env.DRONE_MODEL_PATH ||
  path.join(__dirname, "..", "visdrone_person_best.pt");

// ============================================================
// PYTHON DETECTION SCRIPT
// ============================================================

const SCRIPT_PATH = path.join(
  __dirname,
  "droneDetection.py"
);

// ============================================================
// TIMEOUT
// ============================================================

const TIMEOUT_MS =
  10 * 60 * 1000;

// ============================================================
// ACTIVE SESSIONS
// ============================================================

const activeSessions = new Map();

// ============================================================
// ACTIVE MJPEG FEEDS
// ============================================================

const activeFeeds = new Map();


// ============================================================
// BATCH ANALYSIS
// ============================================================

function runPythonDroneDetection(videoPath) {

  return new Promise((resolve, reject) => {

    const child = spawn(
      PYTHON_PATH,
      [
        SCRIPT_PATH,
        MODEL_PATH,
        videoPath,
        "analyze",
      ]
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    // --------------------------------------------------------
    // TIMEOUT
    // --------------------------------------------------------

    const timeout = setTimeout(() => {

      if (finished) return;

      finished = true;

      try {
        child.kill();
      } catch {}

      reject(
        new Error(
          "Drone detection timed out"
        )
      );

    }, TIMEOUT_MS);

    // --------------------------------------------------------
    // STDOUT
    // --------------------------------------------------------

    child.stdout.on(
      "data",
      (data) => {

        stdout += data.toString();

      }
    );

    // --------------------------------------------------------
    // STDERR
    // --------------------------------------------------------

    child.stderr.on(
      "data",
      (data) => {

        stderr += data.toString();

      }
    );

    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    child.on(
      "error",
      (error) => {

        if (finished) return;

        finished = true;

        clearTimeout(timeout);

        reject(error);

      }
    );

    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------

    child.on(
      "close",
      (code) => {

        if (finished) return;

        finished = true;

        clearTimeout(timeout);

        let parsed = null;

        try {

          parsed = JSON.parse(
            stdout.trim()
          );

        } catch {

          parsed = null;

        }

        // Python logs stay on stderr.
        if (stderr.trim()) {

          console.error(
            "[drone-python]",
            stderr.trim()
          );

        }

        // ----------------------------------------------------
        // PROCESS ERROR
        // ----------------------------------------------------

        if (code !== 0) {

          const detail =
            parsed?.error ||
            stderr.trim() ||
            "Unknown Python error";

          return reject(
            new Error(
              `Drone detection failed (exit code ${code}): ${detail}`
            )
          );

        }

        // ----------------------------------------------------
        // INVALID OUTPUT
        // ----------------------------------------------------

        if (!parsed) {

          return reject(
            new Error(
              `Could not parse Python output: ${stdout.trim()}`
            )
          );

        }

        // ----------------------------------------------------
        // PYTHON ERROR
        // ----------------------------------------------------

        if (parsed.error) {

          return reject(
            new Error(
              parsed.error
            )
          );

        }

        resolve(parsed);

      }
    );

  });
}


// ============================================================
// ANALYZE VIDEO
// ============================================================

async function analyzeDroneVideo(videoPath) {

  if (
    !videoPath ||
    typeof videoPath !== "string"
  ) {

    throw new Error(
      "Video path is required"
    );

  }

  if (!fs.existsSync(videoPath)) {

    throw new Error(
      `Video not found: ${videoPath}`
    );

  }

  if (
    !fs.statSync(videoPath).isFile()
  ) {

    throw new Error(
      `Path is not a file: ${videoPath}`
    );

  }

  return runPythonDroneDetection(
    videoPath
  );
}


// ============================================================
// WINDOWS PROCESS TREE KILL
// ============================================================

function killProcessTree(pid) {

  try {

    if (!pid) return;

    if (
      process.platform === "win32"
    ) {

      execSync(
        `taskkill /pid ${pid} /T /F`,
        {
          stdio: "ignore",
          timeout: 5000,
        }
      );

    } else {

      process.kill(
        pid,
        "SIGTERM"
      );

    }

  } catch {

    // Process already stopped.
  }
}


// ============================================================
// SUBSCRIBE TO LIVE SESSION
// ============================================================

function subscribeToSession(
  sessionId,
  sendFn
) {

  const session =
    activeSessions.get(
      sessionId
    );

  if (!session) {

    return false;

  }

  session.subscribers.add(
    sendFn
  );

  // Send buffered events first.
  for (
    const event of session.eventBuffer
  ) {

    try {

      sendFn(event);

    } catch {}

  }

  return true;
}


// ============================================================
// UNSUBSCRIBE
// ============================================================

function unsubscribeFromSession(
  sessionId,
  sendFn
) {

  const session =
    activeSessions.get(
      sessionId
    );

  if (!session) return;

  session.subscribers.delete(
    sendFn
  );
}


// ============================================================
// START LIVE SESSION
// ============================================================

function startLiveSession(source) {

  if (!source) {

    throw new Error(
      "Live source is required"
    );

  }

  const sessionId =
    `live_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const child = spawn(
    PYTHON_PATH,
    [
      SCRIPT_PATH,
      MODEL_PATH,
      source,
      "stream",
    ]
  );

  const session = {

    id: sessionId,

    child,

    source,

    subscribers: new Set(),

    buffer: "",

    // Keeps latest events so frontend
    // does not miss initial detections.
    eventBuffer: [],

  };

  activeSessions.set(
    sessionId,
    session
  );

  console.log(
    `🛰️ [drone-ai] Session ${sessionId} started`
  );

  console.log(
    `[drone-ai] Model: ${MODEL_PATH}`
  );

  console.log(
    `[drone-ai] Source: ${source}`
  );

  // ========================================================
  // STDOUT
  // ========================================================

  child.stdout.on(
    "data",
    (data) => {

      session.buffer +=
        data.toString();

      const lines =
        session.buffer.split("\n");

      session.buffer =
        lines.pop();

      for (
        const line of lines
      ) {

        const trimmed =
          line.trim();

        if (!trimmed) continue;

        try {

          const event =
            JSON.parse(trimmed);

          // ------------------------------------------------
          // BUFFER
          // ------------------------------------------------

          session.eventBuffer.push(
            event
          );

          // Keep last 10 events.
          if (
            session.eventBuffer.length >
            10
          ) {

            session.eventBuffer.shift();

          }

          // ------------------------------------------------
          // SEND TO CLIENTS
          // ------------------------------------------------

          for (
            const subscriber of
            session.subscribers
          ) {

            try {

              subscriber(event);

            } catch {}

          }

        } catch (error) {

          console.error(
            "[drone-ai] JSON parse error:",
            error.message
          );

        }

      }

    }
  );

  // ========================================================
  // STDERR
  // ========================================================

  child.stderr.on(
    "data",
    (data) => {

      console.error(
        "[drone-ai]",
        data.toString().trim()
      );

    }
  );

  // ========================================================
  // PROCESS ERROR
  // ========================================================

  child.on(
    "error",
    (error) => {

      console.error(
        `[drone-ai] ${sessionId} error:`,
        error.message
      );

      for (
        const subscriber of
        session.subscribers
      ) {

        try {

          subscriber({

            type: "error",

            error: error.message,

          });

        } catch {}

      }

      cleanupSession(
        sessionId
      );

    }
  );

  // ========================================================
  // PROCESS CLOSED
  // ========================================================

  child.on(
    "close",
    (code, signal) => {

      console.log(
        `[drone-ai] ${sessionId} closed`,
        `code=${code}`,
        `signal=${signal}`
      );

      for (
        const subscriber of
        session.subscribers
      ) {

        try {

          subscriber({

            type: "complete",

          });

        } catch {}

      }

      cleanupSession(
        sessionId
      );

    }
  );

  return sessionId;
}


// ============================================================
// CLEAN SESSION
// ============================================================

function cleanupSession(
  sessionId
) {

  const session =
    activeSessions.get(
      sessionId
    );

  if (!session) return;

  session.subscribers.clear();

  activeSessions.delete(
    sessionId
  );
}


// ============================================================
// STOP LIVE SESSION
// ============================================================

function stopLiveSession(
  sessionId
) {

  const session =
    activeSessions.get(
      sessionId
    );

  if (!session) return;

  console.log(
    `[drone-ai] Stopping ${sessionId}`
  );

  session.subscribers.clear();

  if (
    session.child?.pid
  ) {

    killProcessTree(
      session.child.pid
    );

  }

  cleanupSession(
    sessionId
  );
}


// ============================================================
// START REAL DRONE MJPEG FEED
// ============================================================

function startDroneFeed(res) {

  const droneUrl =
    process.env.DRONE_STREAM_URL;

  if (!droneUrl) {

    res.status(503).json({

      success: false,

      message:
        "DRONE_STREAM_URL is not configured on the server.",

    });

    return null;
  }

  const feedId =
    `feed_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const child = spawn(
    PYTHON_PATH,
    [
      SCRIPT_PATH,
      MODEL_PATH,
      droneUrl,
      "mjpeg",
    ]
  );

  activeFeeds.set(
    feedId,
    {
      id: feedId,
      child,
      res,
    }
  );

  console.log(
    `📡 [drone-feed] ${feedId} started`
  );

  console.log(
    `[drone-feed] Model: ${MODEL_PATH}`
  );

  console.log(
    `[drone-feed] Source: ${droneUrl}`
  );

  // ========================================================
  // MJPEG HEADERS
  // ========================================================

  res.writeHead(
    200,
    {

      "Content-Type":
        "multipart/x-mixed-replace; boundary=frame",

      "Cache-Control":
        "no-cache, no-store, must-revalidate",

      Pragma: "no-cache",

      Connection: "keep-alive",

      "X-Accel-Buffering":
        "no",

    }
  );

  // ========================================================
  // PYTHON → BROWSER
  // ========================================================

  child.stdout.pipe(
    res
  );

  // ========================================================
  // STDERR
  // ========================================================

  child.stderr.on(
    "data",
    (data) => {

      console.error(
        "[drone-feed]",
        data.toString().trim()
      );

    }
  );

  // ========================================================
  // ERROR
  // ========================================================

  child.on(
    "error",
    (error) => {

      console.error(
        "[drone-feed] error:",
        error.message
      );

      try {

        if (!res.headersSent) {

          res.status(500).end();

        } else {

          res.end();

        }

      } catch {}

      cleanupFeed(
        feedId
      );

    }
  );

  // ========================================================
  // CLOSE
  // ========================================================

  child.on(
    "close",
    () => {

      cleanupFeed(
        feedId
      );

    }
  );

  // ========================================================
  // BROWSER DISCONNECTED
  // ========================================================

  res.on(
    "close",
    () => {

      if (
        activeFeeds.has(feedId)
      ) {

        killProcessTree(
          child.pid
        );

        cleanupFeed(
          feedId
        );

      }

    }
  );

  return feedId;
}


// ============================================================
// CLEAN FEED
// ============================================================

function cleanupFeed(
  feedId
) {

  activeFeeds.delete(
    feedId
  );
}


// ============================================================
// STOP EVERYTHING
// ============================================================

function stopAllSessions() {

  // ----------------------------------------------------------
  // LIVE AI
  // ----------------------------------------------------------

  for (
    const sessionId of
    activeSessions.keys()
  ) {

    stopLiveSession(
      sessionId
    );

  }

  // ----------------------------------------------------------
  // MJPEG
  // ----------------------------------------------------------

  for (
    const [feedId, feed]
    of activeFeeds.entries()
  ) {

    if (
      feed.child?.pid
    ) {

      killProcessTree(
        feed.child.pid
      );

    }

    activeFeeds.delete(
      feedId
    );

  }
}


// ============================================================
// PROCESS CLEANUP
// ============================================================

process.on(
  "exit",
  stopAllSessions
);

process.on(
  "SIGINT",
  () => {

    stopAllSessions();

    process.exit();

  }
);

process.on(
  "SIGTERM",
  () => {

    stopAllSessions();

    process.exit();

  }
);


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  analyzeDroneVideo,

  startLiveSession,

  stopLiveSession,

  subscribeToSession,

  unsubscribeFromSession,

  startDroneFeed,

};