import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// =====================================================
// FIX LEAFLET DEFAULT MARKER ICONS
// =====================================================

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// =====================================================
// CUSTOM ICONS
// =====================================================

const createDisasterIcon = (severity = "MEDIUM") => {
  const level = String(severity).toUpperCase();

  let symbol = "!";
  let className = "moderate";

  if (level === "CRITICAL") {
    className = "critical";
  } else if (level === "HIGH" || level === "WARNING") {
    className = "warning";
  }

  return L.divIcon({
    className: "hawk-disaster-marker-wrapper",
    html: `
      <div class="hawk-disaster-marker ${className}">
        <span>${symbol}</span>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
  });
};

const safeIcon = L.divIcon({
  className: "hawk-disaster-marker-wrapper",
  html: `
    <div class="hawk-disaster-marker safe">
      <span>✓</span>
    </div>
  `,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
  popupAnchor: [0, -20],
});

const userLocationIcon = L.divIcon({
  className: "hawk-user-location-wrapper",
  html: `
    <div class="hawk-user-location">
      <div class="hawk-user-pulse"></div>
      <div class="hawk-user-dot"></div>
    </div>
  `,
  iconSize: [46, 46],
  iconAnchor: [23, 23],
});

const shelterIcon = L.divIcon({
  className: "hawk-shelter-marker-wrapper",
  html: `
    <div class="hawk-shelter-marker">
      <span>⌂</span>
    </div>
  `,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
  popupAnchor: [0, -20],
});

// =====================================================
// MAP CONTROLLER
// =====================================================

const MapController = ({ userLocation }) => {
  const map = useMap();

  useEffect(() => {
    if (userLocation) {
      map.flyTo(
        [userLocation.latitude, userLocation.longitude],
        11,
        {
          duration: 1.2,
        }
      );
    }
  }, [userLocation, map]);

  return null;
};

// =====================================================
// FIND MY LOCATION BUTTON
// =====================================================

const LocationButton = ({ onLocationFound, locating }) => {
  const map = useMap();

  const findLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    onLocationFound(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };

        onLocationFound(location);

        map.flyTo(
          [location.latitude, location.longitude],
          13,
          {
            duration: 1.2,
          }
        );
      },
      () => {
        alert(
          "Unable to get your location. Please allow location access."
        );
        onLocationFound(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  return (
    <button
      type="button"
      onClick={findLocation}
      className="hawk-location-button"
      disabled={locating}
    >
      <span className="hawk-location-crosshair">⌾</span>
      <span>
        {locating ? "Locating..." : "Find My Location"}
      </span>
    </button>
  );
};

// =====================================================
// AUTOMATIC FLOOD MONITORING
// =====================================================
//
// These are the same locations monitored by FloodPrediction.
// The map calls the existing backend prediction endpoint directly,
// so markers are generated from the actual flood-risk result.
// No hardcoded disaster markers are used.
//

const FLOOD_LOCATIONS = [
  { name: "Lahore", latitude: 31.5204, longitude: 74.3587 },
  { name: "Swat", latitude: 35.2227, longitude: 72.4258 },
  { name: "Islamabad", latitude: 33.6844, longitude: 73.0479 },
  { name: "Rawalpindi", latitude: 33.5651, longitude: 73.0169 },
  { name: "Murree", latitude: 33.9073, longitude: 73.3903 },
  { name: "Peshawar", latitude: 34.0151, longitude: 71.5249 },
  { name: "Karachi", latitude: 24.8607, longitude: 67.0011 },
];

const normalizeRisk = (risk) => {
  const level = String(risk || "").trim().toUpperCase();

  if (level === "CRITICAL") return "CRITICAL";
  if (level === "HIGH" || level === "WARNING") return "HIGH";
  if (level === "MODERATE" || level === "MEDIUM") return "MODERATE";
  if (level === "LOW") return "LOW";

  return "";
};

// =====================================================
// NORMALIZE DISASTER DATA
// =====================================================

const normalizeDisaster = (item, index) => {
  const latitude =
    item.latitude ??
    item.location?.latitude ??
    item.coordinates?.latitude ??
    item.coordinates?.[1];

  const longitude =
    item.longitude ??
    item.location?.longitude ??
    item.coordinates?.longitude ??
    item.coordinates?.[0];

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number"
  ) {
    return null;
  }

  return {
    id: item._id || item.id || `disaster-${index}`,
    type: item.type || "Disaster",
    title:
      item.title ||
      item.description ||
      `${item.type || "Disaster"} Incident`,
    severity:
      item.severity ||
      item.priority ||
      "MEDIUM",
    location:
      typeof item.location === "string"
        ? item.location
        : item.location?.name || "Unknown location",
    latitude,
    longitude,
    status: item.status || "ACTIVE",
    message:
      item.message ||
      item.description ||
      "",
    percentage:
      item.percentage ??
      item.riskProbability ??
      null,
    rainfall: item.rainfall ?? null,
    waterLevel: item.waterLevel ?? null,
    temperature: item.temperature ?? null,
    humidity: item.humidity ?? null,
    weatherCondition: item.weatherCondition ?? null,
    timestamp: item.timestamp ?? null,
  };
};

// =====================================================
// MAIN DISASTER MAP
// =====================================================

const DisasterMap = ({
  disasters = [],
  loading = false,
  error = null,
}) => {
  const [userLocation, setUserLocation] =
    useState(null);

  const [locating, setLocating] =
    useState(false);

  const API_BASE =
    import.meta.env.VITE_API_BASE_URL ||
    "http://localhost:5000";

  const [automaticFloodData, setAutomaticFloodData] =
    useState([]);

  const [autoFloodLoading, setAutoFloodLoading] =
    useState(true);

  const [autoFloodError, setAutoFloodError] =
    useState(null);

  const fetchAutomaticFloodData = async () => {
    setAutoFloodLoading(true);
    setAutoFloodError(null);

    try {
      const results = await Promise.allSettled(
        FLOOD_LOCATIONS.map(async (place) => {
          const response = await fetch(
            `${API_BASE}/api/flood/predict`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                location: place.name,
              }),
            }
          );

          const result = await response.json();

          if (!response.ok || !result.success) {
            throw new Error(
              result.error ||
                result.message ||
                `Unable to predict flood risk for ${place.name}.`
            );
          }

          const data = result.data || {};
          const risk = normalizeRisk(data.risk);

          return {
            id: `flood-prediction-${place.name.toLowerCase()}`,
            type: "Flood",
            title:
              risk === "CRITICAL"
                ? "Critical Flood Risk"
                : risk === "HIGH"
                ? "Flood Warning"
                : risk === "MODERATE"
                ? "Flood Monitoring"
                : "Flood Risk Monitoring",
            severity: risk,
            location: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            status:
              risk === "CRITICAL" || risk === "HIGH"
                ? "ACTIVE"
                : risk === "MODERATE"
                ? "MONITORING"
                : "SAFE",
            message:
              data.recommendation ||
              "Automatic flood risk assessment.",
            percentage: data.percentage ?? 0,
            rainfall: data.rainfall ?? null,
            waterLevel: data.waterLevel ?? null,
            temperature: data.temperature ?? null,
            humidity: data.humidity ?? null,
            weatherCondition:
              data.weatherCondition ?? null,
            timestamp: data.timestamp ?? null,
          };
        })
      );

      const successful = results
        .filter(
          (result) => result.status === "fulfilled"
        )
        .map((result) => result.value)
        .filter((item) => item.severity);

      if (successful.length === 0) {
        throw new Error(
          "No flood prediction data is currently available."
        );
      }

      setAutomaticFloodData(successful);
    } catch (fetchError) {
      console.error(
        "Automatic flood map error:",
        fetchError
      );

      setAutoFloodError(
        fetchError.message ||
          "Unable to load automatic flood predictions."
      );
    } finally {
      setAutoFloodLoading(false);
    }
  };

  useEffect(() => {
    fetchAutomaticFloodData();

    const interval = setInterval(() => {
      fetchAutomaticFloodData();
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [API_BASE]);

  const mapDisasters = useMemo(() => {
    // IMPORTANT: The map is driven by automatic Flood Prediction data.
    // We intentionally do NOT merge the old `disasters` prop here because
    // that data can contain stale/demo CRITICAL or WARNING markers.
    // This keeps the map synchronized with the actual flood prediction API.
    return automaticFloodData
      .filter((item) => item && item.severity)
      .map(normalizeDisaster)
      .filter(Boolean);
  }, [automaticFloodData]);

  const handleLocationFound = (location) => {
    if (location === null) {
      setLocating(true);
      return;
    }

    setLocating(false);

    if (location === false) {
      setUserLocation(null);
      return;
    }

    setUserLocation(location);
  };

  return (
    <div className="hawk-map-card">
      {/* ================================================= */}
      {/* HEADER */}
      {/* ================================================= */}

      <div className="hawk-map-header">
        <div className="hawk-map-title-section">
          <div className="hawk-map-title-icon">
            <span>⌖</span>
          </div>

          <div>
            <h2>Disaster Monitoring Map</h2>
            <p>
              Automatic flood risk monitoring across
              Pakistan
            </p>
          </div>
        </div>

        <div className="hawk-map-live-status">
          <span className="hawk-network-wave">
            ∿
          </span>

          <span>NETWORK ACTIVE</span>

          <span className="hawk-live-badge">
            <span className="hawk-live-dot"></span>
            LIVE
          </span>
        </div>
      </div>

      {/* ================================================= */}
      {/* MAP */}
      {/* ================================================= */}

      <div className="hawk-map-container">
        <MapContainer
          center={[30.3753, 69.3451]}
          zoom={5}
          minZoom={4}
          maxZoom={18}
          scrollWheelZoom={true}
          zoomControl={true}
          className="hawk-leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController
            userLocation={userLocation}
          />

          <LocationButton
            onLocationFound={handleLocationFound}
            locating={locating}
          />

          {/* ============================================= */}
          {/* DISASTER MARKERS */}
          {/* ============================================= */}

          {mapDisasters.map((disaster) => (
            <React.Fragment key={disaster.id}>
              <Marker
                position={[
                  disaster.latitude,
                  disaster.longitude,
                ]}
                icon={
                  disaster.severity === "LOW"
                    ? safeIcon
                    : createDisasterIcon(
                        disaster.severity
                      )
                }
              >
                <Popup>
                  <div className="hawk-popup">
                    <div className="hawk-popup-title">
                      {disaster.title}
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Type:</strong>{" "}
                      {disaster.type}
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Severity:</strong>{" "}
                      {disaster.severity}
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Location:</strong>{" "}
                      {disaster.location}
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Status:</strong>{" "}
                      {disaster.status}
                    </div>

                    {disaster.message && (
                      <div className="hawk-popup-message">
                        {disaster.message}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>

              {(String(
                disaster.severity
              ).toUpperCase() === "CRITICAL" ||
                String(
                  disaster.severity
                ).toUpperCase() === "HIGH") && (
                <Circle
                  center={[
                    disaster.latitude,
                    disaster.longitude,
                  ]}
                  radius={18000}
                  pathOptions={{
                    color:
                      String(
                        disaster.severity
                      ).toUpperCase() ===
                      "CRITICAL"
                        ? "#EF3340"
                        : "#F59E0B",
                    fillColor:
                      String(
                        disaster.severity
                      ).toUpperCase() ===
                      "CRITICAL"
                        ? "#EF3340"
                        : "#F59E0B",
                    fillOpacity: 0.08,
                    weight: 1,
                  }}
                />
              )}
            </React.Fragment>
          ))}

          {/* ============================================= */}
          {/* SHELTER DEMO MARKER */}
          {/* ============================================= */}

          <Marker
            position={[31.5497, 74.3436]}
            icon={shelterIcon}
          >
            <Popup>
              <div className="hawk-popup">
                <div className="hawk-popup-title">
                  Emergency Shelter
                </div>

                <div className="hawk-popup-row">
                  <strong>Location:</strong> Lahore
                </div>

                <div className="hawk-popup-row">
                  <strong>Status:</strong> Available
                </div>
              </div>
            </Popup>
          </Marker>

          {/* ============================================= */}
          {/* USER CURRENT LOCATION */}
          {/* ============================================= */}

          {userLocation && (
            <>
              <Circle
                center={[
                  userLocation.latitude,
                  userLocation.longitude,
                ]}
                radius={userLocation.accuracy || 100}
                pathOptions={{
                  color: "#3B82F6",
                  fillColor: "#3B82F6",
                  fillOpacity: 0.12,
                  weight: 1,
                }}
              />

              <Marker
                position={[
                  userLocation.latitude,
                  userLocation.longitude,
                ]}
                icon={userLocationIcon}
              >
                <Popup>
                  <div className="hawk-popup">
                    <div className="hawk-popup-title">
                      Your Current Location
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Latitude:</strong>{" "}
                      {userLocation.latitude.toFixed(
                        6
                      )}
                    </div>

                    <div className="hawk-popup-row">
                      <strong>Longitude:</strong>{" "}
                      {userLocation.longitude.toFixed(
                        6
                      )}
                    </div>

                    <div className="hawk-popup-message">
                      HawkVision is monitoring this
                      area.
                    </div>
                  </div>
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>
        {/* =============================================== */}
        {/* LEGEND */}
        {/* =============================================== */}

        <div className="hawk-map-legend">
          <div>
            <span className="legend-dot critical"></span>
            CRITICAL
          </div>

          <div>
            <span className="legend-dot warning"></span>
            WARNING
          </div>

          <div>
            <span className="legend-dot moderate"></span>
            MODERATE
          </div>

          <div>
            <span className="legend-dot shelter"></span>
            SHELTER
          </div>

          <div>
            <span className="legend-dot safe"></span>
            SAFE
          </div>

          {userLocation && (
            <div>
              <span className="legend-dot your-location"></span>
              YOUR LOCATION
            </div>
          )}
        </div>

        {/* =============================================== */}
        {/* LOADING */}
        {/* =============================================== */}

        {(loading || autoFloodLoading) && (
          <div className="hawk-map-overlay">
            Loading automatic flood risk data...
          </div>
        )}

        {(error || autoFloodError) && (
          <div className="hawk-map-error">
            {autoFloodError
              ? "Automatic flood predictions unavailable"
              : "Unable to load live disaster data"}
          </div>
        )}
      </div>

      {/* ================================================= */}
      {/* MAP CSS */}
      {/* ================================================= */}

      <style>{`
        .hawk-map-card {
          width: 100%;
          background: #111C31;
          border: 1px solid #1D304D;
          border-radius: 16px;
          padding: 24px;
          box-sizing: border-box;
        }

        .hawk-map-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 20px;
        }

        .hawk-map-title-section {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .hawk-map-title-icon {
          width: 64px;
          height: 64px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.35);
          color: #3B82F6;
          font-size: 32px;
        }

        .hawk-map-title-section h2 {
          margin: 0;
          color: #F1F5F9;
          font-size: 20px;
          font-weight: 700;
        }

        .hawk-map-title-section p {
          margin: 5px 0 0;
          color: #8FA4C2;
          font-size: 14px;
        }

        .hawk-map-live-status {
          display: flex;
          align-items: center;
          gap: 9px;
          color: #3B82F6;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }

        .hawk-network-wave {
          color: #22C55E;
          font-size: 27px;
          line-height: 1;
        }

        .hawk-live-badge {
          margin-left: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          border-radius: 20px;
          color: #F1F5F9;
          border: 1px solid rgba(239, 51, 64, 0.6);
          background: rgba(239, 51, 64, 0.08);
        }

        .hawk-live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #EF3340;
          box-shadow: 0 0 10px rgba(239, 51, 64, 0.9);
        }

        .hawk-map-container {
          position: relative;
          height: 420px;
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid #263B58;
          background: #0B1220;
        }

        .hawk-leaflet-map {
          width: 100%;
          height: 100%;
          z-index: 1;
        }

        .hawk-leaflet-map .leaflet-control-zoom {
          margin-top: 14px;
          margin-left: 14px;
          border: none;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.35);
        }

        .hawk-leaflet-map .leaflet-control-zoom a {
          width: 34px;
          height: 34px;
          line-height: 34px;
          color: #F1F5F9;
          background: #111C31;
          border-color: #263B58;
        }

        .hawk-leaflet-map .leaflet-control-zoom a:hover {
          background: #172640;
        }

        .hawk-location-button {
          position: absolute;
          top: 14px;
          left: 55px;
          z-index: 1000;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 15px;
          border: 1px solid #263B58;
          border-radius: 9px;
          background: #111C31;
          color: #F1F5F9;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.35);
          transition: all 0.2s ease;
        }

        .hawk-location-button:hover {
          background: #172640;
          border-color: #3B82F6;
          transform: translateY(-1px);
        }

        .hawk-location-button:disabled {
          opacity: 0.65;
          cursor: wait;
        }

        .hawk-location-crosshair {
          color: #3B82F6;
          font-size: 20px;
          line-height: 1;
        }
        .hawk-map-legend {
          position: absolute;
          bottom: 14px;
          left: 14px;
          z-index: 1000;
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 10px 14px;
          border-radius: 9px;
          background: rgba(8, 15, 30, 0.94);
          border: 1px solid #263B58;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(10px);
        }

        .hawk-map-legend > div {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #D7E2F0;
          font-size: 10px;
          font-weight: 600;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .legend-dot.critical {
          background: #EF3340;
          box-shadow: 0 0 8px rgba(239, 51, 64, 0.7);
        }

        .legend-dot.warning {
          background: #F59E0B;
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.7);
        }

        .legend-dot.moderate {
          background: #3B82F6;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.7);
        }

        .legend-dot.safe {
          background: #22C55E;
        }

        .legend-dot.shelter {
          background: #22C55E;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.7);
        }

        .legend-dot.your-location {
          background: #3B82F6;
          border: 2px solid #F1F5F9;
          box-sizing: border-box;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.9);
        }

        .hawk-disaster-marker-wrapper,
        .hawk-user-location-wrapper,
        .hawk-shelter-marker-wrapper {
          background: transparent !important;
          border: none !important;
        }

        .hawk-disaster-marker {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 19px;
          font-weight: 800;
          border: 3px solid rgba(255, 255, 255, 0.82);
          box-shadow: 0 0 0 5px rgba(239, 51, 64, 0.12),
            0 5px 20px rgba(0, 0, 0, 0.35);
        }

        .hawk-disaster-marker.critical {
          background: #EF3340;
        }

        .hawk-disaster-marker.warning {
          background: #F59E0B;
        }

        .hawk-disaster-marker.safe {
          background: #22c55e;
          border: 3px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.18), 0 6px 16px rgba(0, 0, 0, 0.35);
        }

        .hawk-disaster-marker.safe span {
          font-size: 19px;
        }

        .hawk-disaster-marker.moderate {
          background: #3B82F6;
        }

        .hawk-shelter-marker {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          background: #22C55E;
          border: 3px solid rgba(255, 255, 255, 0.85);
          box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.13),
            0 5px 20px rgba(0, 0, 0, 0.35);
          font-size: 20px;
          font-weight: 800;
        }

        .hawk-user-location {
          position: relative;
          width: 46px;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .hawk-user-pulse {
          position: absolute;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.18);
          border: 1px solid rgba(59, 130, 246, 0.55);
          animation: hawkLocationPulse 2s infinite;
        }

        .hawk-user-dot {
          position: relative;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #3B82F6;
          border: 3px solid #F1F5F9;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.95);
          z-index: 2;
        }

        @keyframes hawkLocationPulse {
          0% {
            transform: scale(0.75);
            opacity: 0.8;
          }

          70% {
            transform: scale(1.35);
            opacity: 0.15;
          }

          100% {
            transform: scale(1.35);
            opacity: 0;
          }
        }

        .hawk-popup {
          min-width: 190px;
          color: #172033;
          font-family: Arial, sans-serif;
        }

        .hawk-popup-title {
          margin-bottom: 8px;
          font-size: 15px;
          font-weight: 800;
        }

        .hawk-popup-row {
          margin: 4px 0;
          font-size: 12px;
        }

        .hawk-popup-message {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #ddd;
          font-size: 12px;
        }

        .hawk-map-overlay {
          position: absolute;
          inset: 0;
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(8, 15, 30, 0.35);
          color: white;
          font-weight: 600;
          pointer-events: none;
        }

        .hawk-map-error {
          position: absolute;
          left: 50%;
          bottom: 18px;
          transform: translateX(-50%);
          z-index: 1200;
          padding: 8px 13px;
          border-radius: 7px;
          background: rgba(239, 51, 64, 0.92);
          color: white;
          font-size: 11px;
          font-weight: 600;
        }

        @media (max-width: 900px) {
          .hawk-map-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .hawk-map-live-status {
            width: 100%;
            justify-content: flex-end;
          }

          .hawk-map-container {
            height: 380px;
          }

          .hawk-map-legend {
            max-width: calc(100% - 28px);
            overflow-x: auto;
          }
        }

        @media (max-width: 600px) {
          .hawk-map-card {
            padding: 15px;
          }

          .hawk-map-title-icon {
            width: 52px;
            height: 52px;
          }

          .hawk-map-container {
            height: 330px;
          }

          .hawk-map-legend {
            gap: 10px;
          }

          .hawk-map-legend > div {
            white-space: nowrap;
          }        }
      `}</style>
    </div>
  );
};

export default DisasterMap;