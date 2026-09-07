import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Video,
  Camera,
  Upload,
  Play,
  Pause,
  Maximize2,
  Radio,
  Wifi,
  Signal,
  Activity,
  Crosshair,
  Users,
  AlertTriangle,
  ShieldCheck,
  Eye,
  Loader2,
  Zap,
  Square,
  X,
  Images,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api/drone";

const ACCEPTED_VIDEO_TYPES =
  "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

const formatPercent = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return "0%";

  // Backend confidence is normally 0-1.
  if (n <= 1) return `${Math.round(n * 100)}%`;

  return `${Math.round(n)}%`;
};

const getConfidenceNumber = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return n <= 1 ? n : n / 100;
};

const priorityFromConfidence = (confidence) => {
  const n = getConfidenceNumber(confidence);

  if (n >= 0.75) return "HIGH";
  if (n >= 0.5) return "MEDIUM";
  return "LOW";
};

const getPriorityStyle = (priority) => {
  switch (priority) {
    case "HIGH":
      return {
        text: "text-[#EF3340]",
        border: "border-[#EF3340]",
        ring: "ring-[#EF3340]/50",
        dot: "bg-[#EF3340]",
        labelBg: "bg-[#EF3340]",
        labelText: "text-white",
      };

    case "MEDIUM":
      return {
        text: "text-[#F59E0B]",
        border: "border-[#F59E0B]",
        ring: "ring-[#F59E0B]/50",
        dot: "bg-[#F59E0B]",
        labelBg: "bg-[#F59E0B]",
        labelText: "text-[#111827]",
      };

    default:
      return {
        text: "text-[#22C55E]",
        border: "border-[#22C55E]",
        ring: "ring-[#22C55E]/50",
        dot: "bg-[#22C55E]",
        labelBg: "bg-[#22C55E]",
        labelText: "text-[#052E16]",
      };
  }
};

function DroneSurveillance() {
  // ------------------------------------------------------------
  // VIDEO STATE
  // ------------------------------------------------------------

  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);

  // ------------------------------------------------------------
  // MODE
  // ------------------------------------------------------------

  const [mode, setMode] = useState("none");
  // none
  // video
  // drone-live

  // ------------------------------------------------------------
  // DRONE LIVE STREAM
  // ------------------------------------------------------------

  const [droneConnected, setDroneConnected] = useState(false);
  const [droneFeedUrl, setDroneFeedUrl] = useState("");
  const [droneError, setDroneError] = useState(null);

  // ------------------------------------------------------------
  // AI STATE
  // ------------------------------------------------------------

  const [aiStatus, setAiStatus] = useState("idle");
  const [aiData, setAiData] = useState(null);
  const [liveFrames, setLiveFrames] = useState([]);
  const [liveTrackMap, setLiveTrackMap] = useState({});

  const [evidenceItems, setEvidenceItems] = useState([]);
  const [evidencePreview, setEvidencePreview] = useState(null);
  const [evidenceZoom, setEvidenceZoom] = useState(1);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedTrackId, setSelectedTrackIdState] = useState(null);

  const setSelectedTrackId = (value) => {
    selectedTrackIdRef.current = value;
    setSelectedTrackIdState(value);
  };

  // ------------------------------------------------------------
  // BACKEND VIDEO LIST
  // ------------------------------------------------------------

  const [backendVideos, setBackendVideos] = useState([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState(null);

  // ------------------------------------------------------------
  // REFS
  // ------------------------------------------------------------

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const viewportRef = useRef(null);

  const eventSourceRef = useRef(null);
  const sessionIdRef = useRef(null);
  const isStartingRef = useRef(false);

  const liveFramesRef = useRef([]);
  const liveTrackMapRef = useRef({});
  const evidenceItemsRef = useRef([]);

  const videoWidthRef = useRef(0);
  const videoHeightRef = useRef(0);

  const selectedTrackIdRef = useRef(null);

  // ------------------------------------------------------------
  // FETCH STORED DRONE VIDEOS
  // ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const loadVideos = async () => {
      setVideosLoading(true);
      setVideosError(null);

      try {
        const response = await fetch(`${API_URL}/videos`);

        if (!response.ok) {
          throw new Error(`Video server returned HTTP ${response.status}`);
        }

        const json = await response.json();

        if (cancelled) return;

        setBackendVideos(json?.data || []);
      } catch (error) {
        if (!cancelled) {
          console.error("[DroneSurveillance] video list:", error);
          setVideosError(error.message);
        }
      } finally {
        if (!cancelled) {
          setVideosLoading(false);
        }
      }
    };

    loadVideos();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------
  // CLEAN OBJECT URL
  // ------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // ------------------------------------------------------------
  // STOP AI SESSION
  // ------------------------------------------------------------

  const stopAIAnalysis = async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    isStartingRef.current = false;

    if (sessionId) {
      try {
        await fetch(`${API_URL}/live/${sessionId}`, {
          method: "DELETE",
        });
      } catch (error) {
        console.warn("Could not stop AI session:", error);
      }
    }

    setAiStatus("idle");
  };

  // ------------------------------------------------------------
  // RESET AI
  // ------------------------------------------------------------

  const resetAI = () => {
    liveFramesRef.current = [];
    liveTrackMapRef.current = {};

    setLiveFrames([]);
    setLiveTrackMap({});
    evidenceItemsRef.current = [];
    setEvidenceItems([]);
    setAiData(null);
    setAnalyzeError(null);
    setSelectedTrackId(null);
  };

  // ------------------------------------------------------------
  // START REAL-TIME YOLO ANALYSIS
  // ------------------------------------------------------------

  const startAIAnalysis = async (fileName) => {
    if (!fileName) return;

    if (sessionIdRef.current || isStartingRef.current) return;

    isStartingRef.current = true;
    setAiStatus("starting");
    setAnalyzeError(null);

    try {
      const response = await fetch(`${API_URL}/live/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(
          json.message ||
            json.error ||
            "Unable to start drone AI analysis"
        );
      }

      const sessionId = json.sessionId;

      sessionIdRef.current = sessionId;

      const eventSource = new EventSource(
        `${API_URL}/live/${sessionId}/stream`
      );

      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // -----------------------------
          // CONNECTED
          // -----------------------------

          if (data.type === "connected") {
            return;
          }

          // -----------------------------
          // META
          // -----------------------------

          if (data.type === "meta") {
            setAiStatus("live");
            return;
          }

          // -----------------------------
          // DETECTION (backend live event)
          // -----------------------------

          if (data.type === "detection") {
            setAiStatus((previous) =>
              previous === "starting" ? "live" : previous
            );

            const frame = {
              type: "frame",
              frame: data.frame,
              timestamp: data.timestamp,
              detections: Array.isArray(data.victims)
                ? data.victims
                : [],
              tracks: Array.isArray(data.victims)
                ? data.victims
                : [],
              counts: data.counts,
            };

            liveFramesRef.current.push(frame);

            // Keep memory bounded.
            if (liveFramesRef.current.length > 300) {
              liveFramesRef.current.shift();
            }

            // Only tracks visible in THIS AI frame are active.
            // Historical tracks must not stay in the panel forever.
            const nextMap = {};
            const currentItems = Array.isArray(data.victims)
              ? data.victims
              : [];

            currentItems.forEach((victim) => {
              nextMap[victim.id] = victim;
            });

            liveTrackMapRef.current = nextMap;

            setLiveFrames([...liveFramesRef.current]);
            setLiveTrackMap(nextMap);

            if (Array.isArray(data.evidence) && data.evidence.length > 0) {
              const mergedEvidence = [...evidenceItemsRef.current];

              data.evidence.forEach((item) => {
                if (!item?.fileName) return;

                if (!mergedEvidence.some((existing) => existing.fileName === item.fileName)) {
                  mergedEvidence.push({
                    ...item,
                    url: `${API_URL}/evidence/${encodeURIComponent(item.fileName)}`,
                  });
                }
              });

              evidenceItemsRef.current = mergedEvidence.slice(-60);
              setEvidenceItems([...evidenceItemsRef.current]);
            }

            if (
              !selectedTrackIdRef.current &&
              Array.isArray(data.victims) &&
              data.victims.length > 0
            ) {
              setSelectedTrackId(data.victims[0].id);
            }

            return;
          }

          // -----------------------------
          // FRAME (legacy frontend format)
          // -----------------------------

          if (data.type === "frame") {
            liveFramesRef.current.push(data);

            // Keep memory bounded.
            if (liveFramesRef.current.length > 300) {
              liveFramesRef.current.shift();
            }

            const items = data.tracks || data.detections || [];
            const nextMap = {};

            items.forEach((track) => {
              nextMap[track.id] = track;
            });

            liveTrackMapRef.current = nextMap;

            setLiveFrames([...liveFramesRef.current]);
            setLiveTrackMap(nextMap);

            if (Array.isArray(data.evidence) && data.evidence.length > 0) {
              const mergedEvidence = [...evidenceItemsRef.current];
              data.evidence.forEach((item) => {
                if (!item?.fileName) return;
                if (!mergedEvidence.some((existing) => existing.fileName === item.fileName)) {
                  mergedEvidence.push({
                    ...item,
                    url: `${API_URL}/evidence/${encodeURIComponent(item.fileName)}`,
                  });
                }
              });
              evidenceItemsRef.current = mergedEvidence.slice(-60);
              setEvidenceItems([...evidenceItemsRef.current]);
            }

            if (
              !selectedTrackIdRef.current &&
              items.length > 0
            ) {
              setSelectedTrackId(items[0].id);
            }

            return;
          }

          // -----------------------------
          // COMPLETE
          // -----------------------------

          if (data.type === "complete") {
            // Analysis ended: remove every stale box immediately.
            liveFramesRef.current = [];
            liveTrackMapRef.current = {};
            setLiveFrames([]);
            setLiveTrackMap({});
            setSelectedTrackId(null);
            setAiStatus("complete");
            isStartingRef.current = false;

            eventSource.close();
            eventSourceRef.current = null;
            return;
          }

          // -----------------------------
          // ERROR
          // -----------------------------

          if (data.type === "error") {
            setAnalyzeError(
              data.error || "Drone AI analysis error"
            );

            setAiStatus("error");
            isStartingRef.current = false;

            eventSource.close();
            eventSourceRef.current = null;
          }
        } catch (error) {
          console.error(
            "[DroneSurveillance] SSE parse error:",
            error
          );
        }
      };

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          setAiStatus("error");
          setAnalyzeError(
            "Connection to drone AI server was lost."
          );
          isStartingRef.current = false;
        }
      };
    } catch (error) {
      console.error(
        "[DroneSurveillance] AI start error:",
        error
      );

      setAnalyzeError(error.message);
      setAiStatus("error");
      sessionIdRef.current = null;
      isStartingRef.current = false;
    }
  };

  // ------------------------------------------------------------
  // NORMALIZE TRACK
  // ------------------------------------------------------------

  const normalizeTrack = (track) => {
    const confidence = getConfidenceNumber(track.confidence);

    const priority =
      track.priority ||
      track.risk ||
      priorityFromConfidence(confidence);

    const bbox = track.bbox || track.box;

    const normalizedBbox = bbox
      ? normalizeBbox(bbox)
      : bbox;

    return {
      ...track,
      id: String(track.id),
      confidence,
      priority,
      bbox: normalizedBbox,
      status:
        track.status ||
        "TRACKING",
    };
  };

  // ------------------------------------------------------------
  // NORMALIZE BBOX
  //
  // Backend uses pixel coordinates {x,y,width,height} relative
  // to the original frame. Convert to percentage {x1,y1,x2,y2}
  // relative to the video's natural dimensions.
  // ------------------------------------------------------------

  const normalizeBbox = (bbox) => {
    const x = Number(bbox.x ?? bbox.left ?? 0);
    const y = Number(bbox.y ?? bbox.top ?? 0);
    const width = Number(
      bbox.width ??
        (bbox.x2 != null && bbox.x1 != null
          ? bbox.x2 - bbox.x1
          : 0)
    );
    const height = Number(
      bbox.height ??
        (bbox.y2 != null && bbox.y1 != null
          ? bbox.y2 - bbox.y1
          : 0)
    );

    const videoWidth = videoWidthRef.current || 1;
    const videoHeight = videoHeightRef.current || 1;

    const x1 = (x / videoWidth) * 100;
    const y1 = (y / videoHeight) * 100;
    const x2 = ((x + width) / videoWidth) * 100;
    const y2 = ((y + height) / videoHeight) * 100;

    return {
      x1,
      y1,
      x2,
      y2,
    };
  };

  // ------------------------------------------------------------
  // SELECT BACKEND VIDEO
  // ------------------------------------------------------------

  const selectBackendVideo = async (video) => {
    if (!video?.fileName) return;

    await stopAIAnalysis();

    resetAI();

    if (videoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(videoUrl);
    }

    const url = `${API_URL}/videos/${encodeURIComponent(
      video.fileName
    )}`;

    setSelectedVideo(video);
    setVideoUrl(url);
    setVideoName(video.originalName || video.fileName);
    setMode("video");

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setProgress(0);
    setDroneConnected(false);
    setDroneFeedUrl("");

    // Start AI analysis automatically for stored footage.
    await startAIAnalysis(video.fileName);
  };

  // ------------------------------------------------------------
  // LOCAL VIDEO UPLOAD
  // ------------------------------------------------------------

  const handleLocalVideo = async (file) => {
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      alert("Please select an MP4, WebM or MOV drone video.");
      return;
    }

    await stopAIAnalysis();

    resetAI();

    if (videoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(videoUrl);
    }

    const url = URL.createObjectURL(file);

    setSelectedVideo(file);
    setVideoUrl(url);
    setVideoName(file.name);

    setMode("video");

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setProgress(0);

    setDroneConnected(false);
    setDroneFeedUrl("");
  };

  // ------------------------------------------------------------
  // UPLOAD TO SERVER
  //
  // This makes local footage available to the YOLO backend.
  // ------------------------------------------------------------

  const uploadVideoToServer = async (file) => {
    if (!file) return null;

    try {
      const formData = new FormData();

      formData.append("video", file);

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(
          json.message ||
            json.error ||
            "Drone video upload failed"
        );
      }

      return json.data;
    } catch (error) {
      console.error(
        "[DroneSurveillance] upload error:",
        error
      );

      throw error;
    }
  };

  // ------------------------------------------------------------
  // FILE INPUT
  // ------------------------------------------------------------

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      // Local preview immediately.
      await handleLocalVideo(file);

      // Upload to backend so YOLO can process it.
      const uploaded = await uploadVideoToServer(file);

      if (uploaded?.fileName) {
        const serverUrl = `${API_URL}/videos/${encodeURIComponent(
          uploaded.fileName
        )}`;

        setVideoUrl(serverUrl);
        setVideoName(uploaded.originalName || uploaded.fileName);

        setSelectedVideo({
          ...file,
          serverFileName: uploaded.fileName,
        });

        setBackendVideos((previous) => [
          {
            fileName: uploaded.fileName,
            originalName: uploaded.originalName,
            size: uploaded.size,
            mimeType: uploaded.mimeType,
            uploadedAt: new Date().toISOString(),
          },
          ...previous,
        ]);

        // Start AI analysis automatically once the file is stored.
        await startAIAnalysis(uploaded.fileName);
      }
    } catch (error) {
      setAnalyzeError(error.message);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // ------------------------------------------------------------
  // START RECORDED VIDEO AI
  // ------------------------------------------------------------

  const startRecordedAI = async () => {
    if (!videoUrl) return;

    if (
      aiStatus === "starting" ||
      aiStatus === "live" ||
      isStartingRef.current
    ) {
      return;
    }

    let fileName = selectedVideo?.serverFileName;

    // If selected from backend.
    if (!fileName && videoUrl.startsWith(API_URL)) {
      fileName = decodeURIComponent(
        videoUrl.substring(
          `${API_URL}/videos/`.length
        )
      );
    }

    if (!fileName) {
      setAnalyzeError(
        "Upload the drone video first so the AI server can process it."
      );
      return;
    }

    try {
      setAiStatus("starting");
      setAnalyzeError(null);
      resetAI();

      await startAIAnalysis(fileName);

      if (videoRef.current?.paused) {
        await videoRef.current.play();
      }
    } catch (error) {
      setAnalyzeError(error.message);
      setAiStatus("error");
      isStartingRef.current = false;
    }
  };

  // ------------------------------------------------------------
  // VIDEO PLAY
  // ------------------------------------------------------------

  const handlePlay = async () => {
    setIsPlaying(true);

    // Start YOLO automatically.
    if (
      mode === "video" &&
      aiStatus !== "live" &&
      aiStatus !== "starting"
    ) {
      await startRecordedAI();
    }
  };

  // ------------------------------------------------------------
  // PLAY / PAUSE
  // ------------------------------------------------------------

  const togglePlay = async () => {
    const video = videoRef.current;

    if (!video) return;

    try {
      if (video.paused) {
        await video.play();
        setIsPlaying(true);

        if (
          mode === "video" &&
          aiStatus !== "live" &&
          aiStatus !== "starting"
        ) {
          await startRecordedAI();
        }
      } else {
        video.pause();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error("Playback error:", error);
    }
  };

  // ------------------------------------------------------------
  // VIDEO TIME
  // ------------------------------------------------------------

  const handleTimeUpdate = () => {
    const video = videoRef.current;

    if (!video) return;

    setCurrentTime(video.currentTime);

    if (video.duration) {
      setProgress(
        (video.currentTime / video.duration) * 100
      );
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;

    if (!video) return;

    setDuration(video.duration || 0);

    videoWidthRef.current = video.videoWidth || 0;
    videoHeightRef.current = video.videoHeight || 0;
  };

  // ------------------------------------------------------------
  // SEEK
  // ------------------------------------------------------------

  const handleSeek = (event) => {
    const video = videoRef.current;

    if (!video || !video.duration) return;

    const rect =
      event.currentTarget.getBoundingClientRect();

    const ratio = Math.min(
      1,
      Math.max(
        0,
        (event.clientX - rect.left) / rect.width
      )
    );

    video.currentTime = ratio * video.duration;
  };

  // ------------------------------------------------------------
  // LIVE DRONE CAMERA
  //
  // IMPORTANT:
  // NO navigator.getUserMedia()
  //
  // This connects to backend drone feed instead of laptop camera.
  // ------------------------------------------------------------

  const startDroneCamera = async () => {
    await stopAIAnalysis();

    resetAI();

    setDroneError(null);

    const feedUrl = `${API_URL}/live/feed?t=${Date.now()}`;

    setDroneFeedUrl(feedUrl);
    setDroneConnected(true);
    setMode("drone-live");

    setSelectedVideo(null);
    setVideoUrl("");
    setVideoName("");

    setIsPlaying(true);
  };

  // ------------------------------------------------------------
  // STOP DRONE CAMERA
  // ------------------------------------------------------------

  const stopDroneCamera = () => {
    setDroneConnected(false);
    setDroneFeedUrl("");
    setMode("none");
    setIsPlaying(false);
  };

  // ------------------------------------------------------------
  // CLEAR EVERYTHING
  // ------------------------------------------------------------

  const clearFootage = async () => {
    await stopAIAnalysis();

    resetAI();

    stopDroneCamera();

    if (videoUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(videoUrl);
    }

    setSelectedVideo(null);
    setVideoUrl("");
    setVideoName("");

    setMode("none");

    setCurrentTime(0);
    setDuration(0);
    setProgress(0);

    setDroneError(null);
    setAnalyzeError(null);
  };

  // ------------------------------------------------------------
  // FULLSCREEN
  // ------------------------------------------------------------

  const handleFullscreen = async () => {
    const element = viewportRef.current;

    if (!element) return;

    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
    }
  };

  // ------------------------------------------------------------
  // LIVE FRAME DETECTIONS
  // ------------------------------------------------------------

  const currentDetections = useMemo(() => {
    if (!liveFrames.length) return [];

    // Match AI detections to the ACTUAL video playback position.
    // Never render the newest event merely because it arrived last.
    const tolerance = 1.25;
    let bestFrame = null;
    let bestDifference = Infinity;

    for (const frame of liveFrames) {
      const timestamp = Number(
        frame.videoTime ?? frame.timestamp ?? 0
      );
      const difference = Math.abs(timestamp - currentTime);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestFrame = frame;
      }
    }

    if (!bestFrame || bestDifference > tolerance) return [];

    const items =
      bestFrame.detections ||
      bestFrame.tracks ||
      [];

    return items.map(normalizeTrack);
  }, [liveFrames, currentTime]);

  // ------------------------------------------------------------
  // BATCH DETECTIONS
  // ------------------------------------------------------------

  const batchDetections = useMemo(() => {
    if (!aiData?.frames?.length) return [];

    let best = null;
    let bestDifference = Infinity;

    for (const frame of aiData.frames) {
      const timestamp = Number(frame.timestamp || 0);

      const difference = Math.abs(
        timestamp - currentTime
      );

      if (difference < bestDifference) {
        bestDifference = difference;
        best = frame;
      }
    }

    if (!best || bestDifference > 1.5) {
      return [];
    }

    return (best.detections || []).map(
      normalizeTrack
    );
  }, [aiData, currentTime]);

  // ------------------------------------------------------------
  // CURRENT DETECTIONS
  // ------------------------------------------------------------

  const detections =
    aiStatus === "live" ||
    aiStatus === "complete"
      ? currentDetections
      : batchDetections;

  // ------------------------------------------------------------
  // ACTIVE TRACKS
  // ------------------------------------------------------------

  const activeTracks = useMemo(() => {
    if (aiStatus === "live") {
      return Object.values(liveTrackMap)
        .map(normalizeTrack)
        .sort((a, b) =>
          String(a.id).localeCompare(String(b.id))
        );
    }

    if (aiData?.tracks?.length) {
      return aiData.tracks.map(normalizeTrack);
    }

    return [];
  }, [aiStatus, liveTrackMap, aiData]);

  // ------------------------------------------------------------
  // STATS
  // ------------------------------------------------------------

  const stats = useMemo(() => {
    const tracks = activeTracks;

    let high = 0;
    let medium = 0;
    let low = 0;

    tracks.forEach((track) => {
      const priority =
        track.priority ||
        priorityFromConfidence(track.confidence);

      if (priority === "HIGH") high++;
      else if (priority === "MEDIUM") medium++;
      else low++;
    });

    return {
      total: tracks.length,
      high,
      medium,
      low,
    };
  }, [activeTracks]);

  // ------------------------------------------------------------
  // SELECTED TARGET
  // ------------------------------------------------------------

  const selectedTrack = useMemo(() => {
    return (
      activeTracks.find(
        (track) =>
          String(track.id) ===
          String(selectedTrackId)
      ) || null
    );
  }, [activeTracks, selectedTrackId]);

  // ------------------------------------------------------------
  // VICTIM EVIDENCE ACTIONS
  // ------------------------------------------------------------

  const openEvidencePreview = (item) => {
    if (!item?.url) return;
    setEvidencePreview(item);
    setEvidenceZoom(1);
  };

  const closeEvidencePreview = () => {
    setEvidencePreview(null);
    setEvidenceZoom(1);
  };

  // ------------------------------------------------------------
  // CLEANUP
  // ------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      if (sessionIdRef.current) {
        fetch(
          `${API_URL}/live/${sessionIdRef.current}`,
          {
            method: "DELETE",
          }
        ).catch(() => {});
      }

      isStartingRef.current = false;
    };
  }, []);

  // ------------------------------------------------------------
  // FORMAT TIME
  // ------------------------------------------------------------

  const formatTime = (seconds) => {
    if (!seconds || !Number.isFinite(seconds)) {
      return "00:00";
    }

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  };

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------

  return (
    <div className="min-h-full space-y-5 bg-[#080F1E] p-6 text-[#F1F5F9]">

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">

        <div>
          <p className="text-[11px] font-bold tracking-[0.25em] text-[#EF3340]">
            AERIAL INTELLIGENCE
          </p>

          <h1 className="mt-1 text-3xl font-bold">
            Drone Surveillance
          </h1>

          <p className="mt-1 text-sm text-[#8FA4B8]">
            Aerial intelligence & visual monitoring
          </p>
        </div>

        <div className="flex items-center gap-3">

          <div className="flex items-center gap-2 rounded-lg border border-[#1D304D] bg-[#0B1425] px-4 py-2">

            <span
              className={`h-2 w-2 rounded-full ${
                mode === "drone-live"
                  ? "animate-pulse bg-[#EF3340]"
                  : mode === "video"
                  ? "bg-[#3B82F6]"
                  : "bg-[#64748B]"
              }`}
            />

            <span className="text-[10px] font-bold tracking-[0.15em]">
              {mode === "drone-live"
                ? "DRONE LIVE"
                : mode === "video"
                ? "VIDEO"
                : "STANDBY"}
            </span>
          </div>

          <button
            onClick={() =>
              setShowOverlay((value) => !value)
            }
            className={`rounded-lg border px-4 py-2 text-[10px] font-bold ${
              showOverlay
                ? "border-[#EF3340] bg-[#EF3340]/10 text-[#EF3340]"
                : "border-[#1D304D] text-[#8FA4B8]"
            }`}
          >
            OVERLAY {showOverlay ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* ======================================================
          STATUS
      ====================================================== */}

      <div
        className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-xs ${
          aiStatus === "live"
            ? "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#22C55E]"
            : aiStatus === "starting"
            ? "border-[#3B82F6]/40 bg-[#3B82F6]/10 text-[#60A5FA]"
            : aiStatus === "error"
            ? "border-[#EF3340]/40 bg-[#EF3340]/10 text-[#EF3340]"
            : "border-[#1D304D] bg-[#0B1425] text-[#8FA4B8]"
        }`}
      >
        {aiStatus === "starting" ? (
          <Loader2
            size={14}
            className="animate-spin"
          />
        ) : aiStatus === "live" ? (
          <Zap size={14} />
        ) : (
          <AlertTriangle
            size={14}
            className="text-[#F59E0B]"
          />
        )}

        <span>
          {aiStatus === "live"
            ? `AI LIVE — ${stats.total} persons currently tracked`
            : aiStatus === "starting"
            ? "Initializing YOLO AI detection engine…"
            : aiStatus === "error"
            ? `AI ERROR — ${
                analyzeError || "Unknown error"
              }`
            : mode === "drone-live"
            ? "Connected to configured drone camera stream."
            : "Select drone footage or connect the live drone camera to begin detection."}
        </span>
      </div>

      {/* ======================================================
          FOOTAGE / CONTROLS
      ====================================================== */}

      <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div className="flex items-center gap-3">

            <Video
              size={18}
              className="text-[#8FA4B8]"
            />

            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                DRONE FOOTAGE
              </p>

              <p className="mt-1 max-w-[500px] truncate text-sm font-semibold">
                {videoName ||
                  (mode === "drone-live"
                    ? "LIVE DRONE CAMERA STREAM"
                    : "No footage selected")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">

            {/* Hidden upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_VIDEO_TYPES}
              onChange={handleFileChange}
              className="hidden"
            />

            {/* SELECT VIDEO */}
            <button
              onClick={() =>
                fileInputRef.current?.click()
              }
              className="flex items-center gap-2 rounded-lg border border-[#3B82F6] bg-[#3B82F6]/10 px-4 py-2.5 text-xs font-bold text-[#60A5FA] hover:bg-[#3B82F6]/20"
            >
              <Upload size={14} />
              SELECT DRONE VIDEO
            </button>

            {/* LIVE DRONE */}
            <button
              onClick={
                mode === "drone-live"
                  ? stopDroneCamera
                  : startDroneCamera
              }
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-bold ${
                mode === "drone-live"
                  ? "border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E]"
                  : "border-[#EF3340] bg-[#EF3340]/10 text-[#EF3340] hover:bg-[#EF3340]/20"
              }`}
            >
              <Camera size={14} />

              {mode === "drone-live"
                ? "STOP DRONE CAMERA"
                : "START LIVE DRONE CAMERA"}
            </button>

            {(videoUrl || mode === "drone-live") && (
              <button
                onClick={clearFootage}
                className="flex items-center gap-2 rounded-lg border border-[#1D304D] px-4 py-2.5 text-xs font-bold text-[#8FA4B8] hover:border-[#EF3340] hover:text-[#EF3340]"
              >
                <X size={14} />
                CLEAR
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ======================================================
          STORED VIDEO SELECTOR
      ====================================================== */}

      <div className="flex items-center gap-3 rounded-lg border border-[#1D304D] bg-[#0B1425] p-3">

        <Video
          size={14}
          className="text-[#8FA4B8]"
        />

        <span className="text-[10px] font-bold tracking-[0.15em] text-[#8FA4B8]">
          STORED DRONE FOOTAGE
        </span>

        <div className="flex-1">

          {videosLoading ? (
            <div className="flex items-center gap-2 text-xs text-[#8FA4B8]">
              <Loader2
                size={13}
                className="animate-spin"
              />
              Loading drone footage…
            </div>
          ) : videosError ? (
            <span className="text-xs text-[#F59E0B]">
              No stored footage available.
            </span>
          ) : backendVideos.length === 0 ? (
            <span className="text-xs text-[#64748B]">
              No stored drone videos.
            </span>
          ) : (
            <select
              value={
                selectedVideo?.serverFileName ||
                (videoUrl?.startsWith(
                  `${API_URL}/videos/`
                )
                  ? decodeURIComponent(
                      videoUrl.substring(
                        `${API_URL}/videos/`.length
                      )
                    )
                  : "")
              }
              onChange={(event) => {
                const video =
                  backendVideos.find(
                    (item) =>
                      item.fileName ===
                      event.target.value
                  );

                if (video) {
                  selectBackendVideo(video);
                }
              }}
              className="w-full rounded-lg border border-[#1D304D] bg-[#080F1E] px-3 py-2 text-xs text-[#F1F5F9] outline-none"
            >
              <option value="">
                Select stored drone footage
              </option>

              {backendVideos.map((video) => (
                <option
                  key={video.fileName}
                  value={video.fileName}
                >
                  {video.fileName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ======================================================
          MAIN GRID
      ====================================================== */}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">

        {/* ====================================================
            VIDEO
        ==================================================== */}

        <div className="space-y-4">

          <div
            ref={viewportRef}
            className="relative h-[540px] overflow-hidden rounded-xl border border-[#1D304D] bg-black"
          >

            {/* ---------------- EMPTY STATE ---------------- */}

            {mode === "none" && (
              <div className="flex h-full items-center justify-center">

                <div className="max-w-md px-6 text-center">

                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#1D304D] bg-[#111C31]">
                    <Radio
                      size={34}
                      className="text-[#3B82F6]"
                    />
                  </div>

                  <h2 className="text-xl font-bold">
                    No Drone Feed Selected
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-[#8FA4B8]">
                    Select recorded drone footage
                    for AI analysis or connect the
                    configured live drone camera.
                  </p>

                  <div className="mt-6 flex justify-center gap-3">

                    <button
                      onClick={() =>
                        fileInputRef.current?.click()
                      }
                      className="flex items-center gap-2 rounded-lg bg-[#3B82F6] px-5 py-3 text-xs font-bold text-white hover:bg-[#2563EB]"
                    >
                      <Upload size={15} />
                      SELECT VIDEO
                    </button>

                    <button
                      onClick={startDroneCamera}
                      className="flex items-center gap-2 rounded-lg border border-[#EF3340] bg-[#EF3340]/10 px-5 py-3 text-xs font-bold text-[#EF3340] hover:bg-[#EF3340]/20"
                    >
                      <Camera size={15} />
                      LIVE DRONE
                    </button>

                  </div>
                </div>
              </div>
            )}

            {/* =================================================
                RECORDED VIDEO
            ================================================= */}

            {mode === "video" && videoUrl && (
              <div className="absolute inset-0">

                <video
                  ref={videoRef}
                  src={videoUrl}
                  muted
                  playsInline
                  className="h-full w-full bg-black object-contain"
                  onPlay={handlePlay}
                  onPause={() =>
                    setIsPlaying(false)
                  }
                  onEnded={() => {
                    setIsPlaying(false);
                    stopAIAnalysis();
                  }}
                  onTimeUpdate={
                    handleTimeUpdate
                  }
                  onLoadedMetadata={
                    handleLoadedMetadata
                  }
                />

                {/* AI OVERLAY */}

                {showOverlay && (
                  <DetectionOverlay
                    detections={detections}
                    selectedTrackId={
                      selectedTrackId
                    }
                    onSelect={
                      setSelectedTrackId
                    }
                    videoRef={videoRef}
                  />
                )}

                {/* HUD */}

                <Hud
                  leftText={`AERIAL VIEW · ${
                    detections.length
                  } TRACKS`}
                  rightText={
                    aiStatus === "live"
                      ? "AI LIVE"
                      : "RECORDED"
                  }
                  live={aiStatus === "live"}
                />

              </div>
            )}

            {/* =================================================
                ACTUAL DRONE CAMERA STREAM
            ================================================= */}

            {mode === "drone-live" && (
              <div className="absolute inset-0 bg-black">

                {droneFeedUrl ? (
                  <img
                    src={droneFeedUrl}
                    alt="Live Drone Camera"
                    className="h-full w-full object-contain"
                    onLoad={() => {
                      setDroneConnected(true);
                      setDroneError(null);
                    }}
                    onError={() => {
                      setDroneConnected(false);
                      setDroneError(
                        "Unable to connect to the configured drone camera stream."
                      );
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Loader2
                      size={32}
                      className="animate-spin text-[#3B82F6]"
                    />
                  </div>
                )}

                {showOverlay && (
                  <DetectionOverlay
                    detections={detections}
                    selectedTrackId={
                      selectedTrackId
                    }
                    onSelect={
                      setSelectedTrackId
                    }
                    videoRef={videoRef}
                  />
                )}

                <Hud
                  leftText={`LIVE DRONE · ${
                    stats.total
                  } TRACKS`}
                  rightText="DRONE LIVE"
                  live
                />

                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-[#22C55E]/40 bg-black/70 px-3 py-2 backdrop-blur">

                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#22C55E]" />

                  <span className="text-[10px] font-bold tracking-[0.15em] text-[#22C55E]">
                    REAL DRONE STREAM
                  </span>
                </div>

                {droneError && (
                  <div className="absolute bottom-4 right-4 max-w-sm rounded-lg border border-[#EF3340]/40 bg-black/80 px-4 py-3 text-xs text-[#EF3340]">
                    {droneError}
                  </div>
                )}

              </div>
            )}

            {/* ANALYSIS LOADING */}

            {analyzing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">

                <div className="text-center">

                  <Loader2
                    size={32}
                    className="mx-auto animate-spin text-[#EF3340]"
                  />

                  <p className="mt-4 text-sm font-bold">
                    Running YOLO AI Detection
                  </p>

                  <p className="mt-1 text-xs text-[#8FA4B8]">
                    Tracking victims in drone footage…
                  </p>

                </div>
              </div>
            )}

          </div>

          {/* ==================================================
              VIDEO CONTROLS
          ================================================== */}

          {mode === "video" && videoUrl && (
            <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

              <div className="flex items-center gap-3">

                <button
                  onClick={togglePlay}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EF3340] text-white"
                >
                  {isPlaying ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                </button>

                <div className="flex-1">

                  <div
                    onClick={handleSeek}
                    className="group relative h-1.5 cursor-pointer rounded-full bg-[#1D304D]"
                  >
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-[#EF3340]"
                      style={{
                        width: `${progress}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 flex justify-between text-[10px] text-[#8FA4B8]">

                    <span>
                      {formatTime(currentTime)}
                    </span>

                    <span>
                      {formatTime(duration)}
                    </span>

                  </div>
                </div>

                <button
                  onClick={clearFootage}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#1D304D] text-[#8FA4B8] hover:text-[#EF3340]"
                >
                  <Square size={15} />
                </button>

                <button
                  onClick={handleFullscreen}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#1D304D] text-[#8FA4B8] hover:text-white"
                >
                  <Maximize2 size={15} />
                </button>

              </div>

              <div className="mt-3 flex justify-end">

                <div
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[10px] font-bold ${
                    aiStatus === "live"
                      ? "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#22C55E]"
                      : aiStatus === "starting"
                      ? "border-[#3B82F6]/40 bg-[#3B82F6]/10 text-[#60A5FA]"
                      : "border-[#1D304D] bg-[#080F1E] text-[#8FA4B8]"
                  }`}
                >
                  {aiStatus === "starting" ? (
                    <Loader2
                      size={13}
                      className="animate-spin"
                    />
                  ) : aiStatus === "live" ? (
                    <Zap size={13} />
                  ) : (
                    <Activity size={13} />
                  )}

                  {aiStatus === "live"
                    ? "AI DETECTION LIVE"
                    : aiStatus === "starting"
                    ? "AI STARTING..."
                    : "AI STANDBY"}
                </div>

              </div>

            </div>
          )}

          {/* ==================================================
              STATS
          ================================================== */}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">

            <StatCard
              label="PERSONS TRACKED"
              value={stats.total}
              icon={Users}
              tone="blue"
            />

            <StatCard
              label="HIGH PRIORITY"
              value={stats.high}
              icon={AlertTriangle}
              tone="red"
            />

            <StatCard
              label="MEDIUM"
              value={stats.medium}
              icon={ShieldCheck}
              tone="amber"
            />

            <StatCard
              label="LOW"
              value={stats.low}
              icon={Eye}
              tone="green"
            />

            <StatCard
              label="ACTIVE TRACKS"
              value={activeTracks.length}
              icon={Activity}
              tone="blue"
            />

          </div>

          {/* ==================================================
              VICTIM EVIDENCE GALLERY
          ================================================== */}

          <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

            <div className="mb-4 flex items-center justify-between">

              <div className="flex items-center gap-2">
                <Images size={15} className="text-[#3B82F6]" />
                <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                  VICTIM EVIDENCE
                </p>
              </div>

              <span className="text-[10px] font-bold text-[#8FA4B8]">
                {evidenceItems.length} CAPTURED
              </span>

            </div>

            {evidenceItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#1D304D] py-8 text-center">
                <Images size={24} className="mx-auto mb-3 text-[#475569]" />
                <p className="text-xs font-semibold text-[#64748B]">
                  No evidence captured yet
                </p>
                <p className="mt-1 text-[10px] text-[#475569]">
                  Confirmed drone detections will be saved here automatically.
                </p>
              </div>
            ) : (
              <div className="grid max-h-[360px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                {evidenceItems.map((item) => (
                  <div
                    key={item.fileName}
                    className="group overflow-hidden rounded-lg border border-[#1D304D] bg-[#080F1E]"
                  >
                    <button
                      type="button"
                      onClick={() => openEvidencePreview(item)}
                      className="relative block aspect-square w-full overflow-hidden bg-black text-left"
                      title="Click to zoom evidence"
                    >
                      <img
                        src={item.url}
                        alt={`Drone evidence ${item.id || "person"}`}
                        className="h-full w-full object-contain transition duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-[9px] font-black text-white">
                        {item.id || "PERSON"}
                      </div>
                      <div className="absolute bottom-2 right-2 rounded-md border border-white/10 bg-black/75 px-2 py-1 text-[8px] font-bold text-white opacity-0 transition group-hover:opacity-100">
                        CLICK TO ZOOM
                      </div>
                    </button>

                    <div className="p-2">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-bold text-[#8FA4B8]">
                          {formatPercent(item.confidence)}
                        </span>
                        <span className="text-[#64748B]">
                          {formatTime(Number(item.timestamp || 0))}
                        </span>
                      </div>
                      <p className="mt-1 text-[8px] font-semibold tracking-wide text-[#475569]">
                        {item.id || "PERSON"} · DRONE CAPTURE
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {evidenceItems.length > 0 && (
              <p className="mt-3 text-[9px] leading-4 text-[#64748B]">
                Evidence is captured automatically from confirmed drone detections. Click any captured person to open a larger view and zoom in without leaving Drone Surveillance.
              </p>
            )}

          </div>

          {evidencePreview && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
              onClick={closeEvidencePreview}
              role="dialog"
              aria-modal="true"
              aria-label="Drone evidence preview"
            >
              <div
                className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#1D304D] bg-[#080F1E] shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-[#1D304D] bg-[#0B1425] px-4 py-3">
                  <div>
                    <p className="text-[10px] font-black tracking-[0.2em] text-[#3B82F6]">
                      DRONE EVIDENCE · {evidencePreview.id || "PERSON"}
                    </p>
                    <p className="mt-1 text-[9px] text-[#64748B]">
                      {formatPercent(evidencePreview.confidence)} confidence · {formatTime(Number(evidencePreview.timestamp || 0))}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEvidenceZoom((value) => Math.max(1, value - 0.25))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1D304D] bg-[#111C31] text-[#8FA4B8] hover:text-white"
                      title="Zoom out"
                    >
                      <ZoomOut size={15} />
                    </button>
                    <span className="min-w-[48px] text-center text-[9px] font-bold text-[#8FA4B8]">
                      {Math.round(evidenceZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setEvidenceZoom((value) => Math.min(4, value + 0.25))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1D304D] bg-[#111C31] text-[#8FA4B8] hover:text-white"
                      title="Zoom in"
                    >
                      <ZoomIn size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={closeEvidencePreview}
                      className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg border border-[#EF3340]/40 bg-[#EF3340]/10 text-[#EF3340] hover:bg-[#EF3340]/20"
                      title="Close"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-center overflow-auto bg-black p-4">
                  <img
                    src={evidencePreview.url}
                    alt={`Expanded drone evidence ${evidencePreview.id || "person"}`}
                    className="max-h-full max-w-full object-contain transition-transform duration-200"
                    style={{ transform: `scale(${evidenceZoom})` }}
                  />
                </div>

                <div className="flex items-center justify-between border-t border-[#1D304D] bg-[#0B1425] px-4 py-2">
                  <span className="text-[8px] font-bold tracking-[0.15em] text-[#475569]">
                    HAWKVISION · DRONE VICTIM EVIDENCE
                  </span>
                  <span className="text-[8px] font-bold text-[#64748B]">
                    ESC TO CLOSE · CLICK OUTSIDE TO CLOSE
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ====================================================
            RIGHT PANEL
        ==================================================== */}

        <div className="space-y-4">

          {/* DRONE STATUS */}

          <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

            <div className="mb-4 flex items-center justify-between">

              <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                DRONE STATUS
              </p>

              <span
                className={`flex items-center gap-1.5 text-[10px] font-bold ${
                  mode === "drone-live"
                    ? "text-[#22C55E]"
                    : "text-[#64748B]"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    mode === "drone-live"
                      ? "bg-[#22C55E]"
                      : "bg-[#64748B]"
                  }`}
                />

                {mode === "drone-live"
                  ? "CONNECTED"
                  : mode === "video"
                  ? "VIDEO MODE"
                  : "READY"}
              </span>

            </div>

            <div className="grid grid-cols-2 gap-2">

              <StatusBox
                icon={Camera}
                label="CAMERA"
                value={
                  mode === "drone-live"
                    ? "ACTIVE"
                    : "STANDBY"
                }
                active={
                  mode === "drone-live"
                }
              />

              <StatusBox
                icon={Video}
                label="VIDEO FEED"
                value={
                  mode !== "none"
                    ? "STABLE"
                    : "OFFLINE"
                }
                active={mode !== "none"}
              />

              <StatusBox
                icon={Signal}
                label="SIGNAL"
                value={
                  mode === "drone-live"
                    ? "STRONG"
                    : mode === "video"
                    ? "N/A"
                    : "—"
                }
                active={
                  mode === "drone-live"
                }
              />

              <StatusBox
                icon={Wifi}
                label="LINK"
                value={
                  mode === "drone-live"
                    ? "DRONE LINK"
                    : "—"
                }
                active={
                  mode === "drone-live"
                }
              />

            </div>
          </div>

          {/* AI ANALYSIS */}

          {(aiData || aiStatus === "live") && (
            <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

              <div className="mb-4 flex items-center justify-between">

                <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                  AI ANALYSIS
                </p>

                <Zap
                  size={14}
                  className="text-[#3B82F6]"
                />

              </div>

              <div className="space-y-3">

                <InfoRow
                  label="ENGINE"
                  value="YOLO"
                />

                <InfoRow
                  label="CLASS"
                  value="PERSON"
                />

                <InfoRow
                  label="TRACKING"
                  value={
                    aiStatus === "live"
                      ? "LIVE"
                      : "READY"
                  }
                />

                {aiData?.summary && (
                  <InfoRow
                    label="AVG CONF."
                    value={formatPercent(
                      aiData.summary
                        .averageConfidence
                    )}
                  />
                )}

              </div>
            </div>
          )}

          {/* ACTIVE TRACKS */}

          <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

            <div className="mb-4 flex items-center justify-between">

              <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                ACTIVE TRACKS
              </p>

              <span className="text-[10px] font-bold text-[#8FA4B8]">
                {activeTracks.length} TOTAL
              </span>

            </div>

            <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">

              {activeTracks.length === 0 ? (

                <div className="rounded-lg border border-dashed border-[#1D304D] py-8 text-center">

                  <Users
                    size={24}
                    className="mx-auto mb-3 text-[#475569]"
                  />

                  <p className="text-xs font-semibold text-[#64748B]">
                    No victims detected
                  </p>

                  <p className="mt-1 text-[10px] text-[#475569]">
                    AI tracks will appear here
                    during detection.
                  </p>

                </div>

              ) : (

                activeTracks.map((track) => {

                  const style =
                    getPriorityStyle(
                      track.priority
                    );

                  const selected =
                    String(track.id) ===
                    String(selectedTrackId);

                  return (
                    <button
                      key={track.id}
                      onClick={() =>
                        setSelectedTrackId(
                          track.id
                        )
                      }
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-[#EF3340]/60 bg-[#EF3340]/10"
                          : "border-transparent hover:border-[#1D304D] hover:bg-[#101B30]"
                      }`}
                    >

                      <div className="flex items-center gap-2">

                        <span
                          className={`h-2 w-2 rounded-full ${style.dot}`}
                        />

                        <span className="text-xs font-bold">
                          {track.id}
                        </span>

                      </div>

                      <div className="flex items-center gap-2">

                        <span className="text-[10px] font-bold text-[#8FA4B8]">
                          {formatPercent(
                            track.confidence
                          )}
                        </span>

                        <span
                          className={`rounded px-2 py-1 text-[8px] font-black ${style.labelBg} ${style.labelText}`}
                        >
                          {track.priority}
                        </span>

                      </div>
                    </button>
                  );
                })
              )}

            </div>
          </div>

          {/* AI COUNTERS */}

          <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

            <div className="mb-4 flex items-center justify-between">

              <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                AI DETECTION
              </p>

              <Crosshair
                size={15}
                className="text-[#3B82F6]"
              />

            </div>

            <div className="grid grid-cols-3 gap-2">

              <RiskCard
                value={stats.high}
                label="HIGH"
                tone="red"
              />

              <RiskCard
                value={stats.medium}
                label="MEDIUM"
                tone="amber"
              />

              <RiskCard
                value={stats.low}
                label="LOW"
                tone="green"
              />

            </div>
          </div>

          {/* SELECTED TARGET */}

          <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-4">

            <div className="mb-4 flex items-center justify-between">

              <p className="text-[11px] font-bold tracking-[0.18em] text-[#8FA4B8]">
                SELECTED TARGET
              </p>

              {selectedTrack && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#EF3340]" />
              )}

            </div>

            {selectedTrack ? (

              <div className="space-y-3">

                <InfoRow
                  label="PERSON ID"
                  value={selectedTrack.id}
                />

                <InfoRow
                  label="CONFIDENCE"
                  value={formatPercent(
                    selectedTrack.confidence
                  )}
                />

                <InfoRow
                  label="PRIORITY"
                  value={selectedTrack.priority}
                />

                <InfoRow
                  label="STATUS"
                  value={
                    selectedTrack.status ||
                    "TRACKING"
                  }
                />

              </div>

            ) : (

              <div className="py-6 text-center">

                <Crosshair
                  size={25}
                  className="mx-auto mb-2 text-[#475569]"
                />

                <p className="text-xs text-[#64748B]">
                  Select a detected target
                </p>

              </div>
            )}

          </div>

        </div>
      </div>

      {/* FOOTER */}

      <div className="flex items-center justify-between rounded-lg border border-[#1D304D] bg-[#0B1425] px-4 py-3">

        <div className="flex items-center gap-2">

          <Activity
            size={14}
            className="text-[#3B82F6]"
          />

          <span className="text-[10px] font-bold tracking-[0.12em] text-[#8FA4B8]">
            HAWKVISION AI • DRONE INTELLIGENCE
          </span>

        </div>

        <span className="text-[10px] text-[#475569]">
          YOLO AI DETECTION ENGINE
        </span>

      </div>

    </div>
  );
}

// ============================================================
// DETECTION OVERLAY
// ============================================================

function DetectionOverlay({
  detections,
  selectedTrackId,
  onSelect,
  videoRef,
}) {
  const containerRef = useRef(null);

  const video = videoRef?.current;
  const container = containerRef.current;

  const videoWidth = video?.videoWidth || 0;
  const videoHeight = video?.videoHeight || 0;

  const containerRect = container?.getBoundingClientRect();
  const containerWidth = containerRect?.width || 1;
  const containerHeight = containerRect?.height || 1;

  // object-contain letterbox math
  const scale =
    videoWidth && videoHeight
      ? Math.min(
          containerWidth / videoWidth,
          containerHeight / videoHeight
        )
      : 0;

  const displayWidth = videoWidth * scale;
  const displayHeight = videoHeight * scale;

  const offsetX = (containerWidth - displayWidth) / 2;
  const offsetY = (containerHeight - displayHeight) / 2;

  const toContainerPercent = (bbox) => {
    const x1 = Number(bbox.x1 || 0);
    const y1 = Number(bbox.y1 || 0);
    const x2 = Number(bbox.x2 || 0);
    const y2 = Number(bbox.y2 || 0);

    const left = offsetX + (x1 / 100) * displayWidth;
    const top = offsetY + (y1 / 100) * displayHeight;
    const width = ((x2 - x1) / 100) * displayWidth;
    const height = ((y2 - y1) / 100) * displayHeight;

    return {
      left: (left / containerWidth) * 100,
      top: (top / containerHeight) * 100,
      width: (width / containerWidth) * 100,
      height: (height / containerHeight) * 100,
    };
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-10"
    >

      {detections.map((det) => {

        const style = getPriorityStyle(
          det.priority
        );

        const bbox = det.bbox;

        if (!bbox) return null;

        const position = toContainerPercent(bbox);

        const selected =
          String(det.id) ===
          String(selectedTrackId);

        return (
          <div
            key={det.id}
            className={`absolute pointer-events-auto cursor-pointer border-2 ${style.border} ${
              selected
                ? `ring-2 ${style.ring}`
                : ""
            }`}
            style={{
              left: `${position.left}%`,
              top: `${position.top}%`,
              width: `${position.width}%`,
              height: `${position.height}%`,
            }}
            onClick={() => onSelect(det.id)}
          >

            <div
              className={`absolute -top-6 left-0 whitespace-nowrap rounded px-2 py-1 text-[9px] font-black ${style.labelBg} ${style.labelText}`}
            >
              {det.id} ·{" "}
              {formatPercent(
                det.confidence
              )}
            </div>

            {selected && (
              <div className="absolute -bottom-6 left-0 rounded bg-black/80 px-2 py-1 text-[9px] font-bold text-white">
                {det.priority}
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// HUD
// ============================================================

function Hud({
  leftText,
  rightText,
  live = false,
}) {
  return (
    <>
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-md border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">

        <Crosshair
          size={13}
          className={
            live
              ? "text-[#22C55E]"
              : "text-[#EF3340]"
          }
        />

        <span className="text-[10px] font-bold tracking-[0.14em] text-white">
          {leftText}
        </span>

      </div>

      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-md border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">

        <Activity
          size={13}
          className={
            live
              ? "animate-pulse text-[#22C55E]"
              : "text-[#EF3340]"
          }
        />

        <span
          className={`text-[10px] font-bold tracking-[0.14em] ${
            live
              ? "text-[#22C55E]"
              : "text-white"
          }`}
        >
          {rightText}
        </span>

      </div>
    </>
  );
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}) {
  const colors = {
    red: "text-[#EF3340]",
    amber: "text-[#F59E0B]",
    green: "text-[#22C55E]",
    blue: "text-[#60A5FA]",
  };

  const color =
    colors[tone] || colors.blue;

  return (
    <div className="rounded-xl border border-[#1D304D] bg-[#0B1425] p-3">

      <div className="mb-2 flex items-center gap-2">

        <Icon
          size={14}
          className={color}
        />

        <span className="text-[9px] font-bold tracking-[0.12em] text-[#8FA4B8]">
          {label}
        </span>

      </div>

      <p
        className={`text-2xl font-black ${color}`}
      >
        {value}
      </p>

    </div>
  );
}

// ============================================================
// STATUS BOX
// ============================================================

function StatusBox({
  icon: Icon,
  label,
  value,
  active,
}) {
  return (
    <div className="rounded-lg border border-[#1D304D] bg-[#080F1E] p-3">

      <div className="mb-2 flex items-center gap-2">

        <Icon
          size={13}
          className="text-[#64748B]"
        />

        <span className="text-[9px] font-bold tracking-[0.1em] text-[#64748B]">
          {label}
        </span>

      </div>

      <span
        className={`text-[10px] font-black ${
          active
            ? "text-[#22C55E]"
            : "text-[#64748B]"
        }`}
      >
        {value}
      </span>

    </div>
  );
}

// ============================================================
// RISK CARD
// ============================================================

function RiskCard({
  value,
  label,
  tone,
}) {
  const styles = {
    red: {
      border: "border-[#EF3340]/40",
      text: "text-[#EF3340]",
    },
    amber: {
      border: "border-[#F59E0B]/40",
      text: "text-[#F59E0B]",
    },
    green: {
      border: "border-[#22C55E]/40",
      text: "text-[#22C55E]",
    },
  };

  const style =
    styles[tone] || styles.green;

  return (
    <div
      className={`rounded-lg border bg-[#080F1E] p-3 text-center ${style.border}`}
    >
      <div
        className={`text-xl font-black ${style.text}`}
      >
        {value}
      </div>

      <div className="mt-1 text-[8px] font-bold tracking-[0.12em] text-[#64748B]">
        {label}
      </div>
    </div>
  );
}

// ============================================================
// INFO ROW
// ============================================================

function InfoRow({
  label,
  value,
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#1D304D] pb-2 last:border-0">

      <span className="text-[9px] font-bold tracking-[0.1em] text-[#64748B]">
        {label}
      </span>

      <span className="text-[10px] font-bold text-[#F1F5F9]">
        {value}
      </span>

    </div>
  );
}

export default DroneSurveillance;