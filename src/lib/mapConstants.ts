// Shared visual/behavioral constants for every Leaflet map in the app (the
// "add/edit location" pin-picker and the "all locations" overview) so they
// look and behave identically instead of drifting apart as separate copies.
// Plain data only (no `leaflet` import here) — this file has no side effects
// and is safe to import from anywhere, even though the maps that use it are
// client-only (`next/dynamic({ ssr: false })`, since Leaflet touches
// `window` at import time).

export const MAP_CENTER_THAILAND: [number, number] = [13.7563, 100.5018];
export const MAP_ZOOM_THAILAND_WIDE = 6;
export const MAP_ZOOM_FOCUSED = 16;

// Same height everywhere a map appears, so the pin-picker (in the add/edit
// form) and the all-locations overview don't look like two different
// components. Shorter on phones so a map doesn't eat the whole first
// screenful before the admin can even see the form fields below it.
export const MAP_HEIGHT_CLASS = "h-[260px] sm:h-[420px]";

export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const OSM_MAX_ZOOM = 19;

// Satellite imagery for the "does the radius actually cover the building?"
// check on the locations workspace — Esri's World Imagery tile service is
// free to use with attribution and needs no API key (unlike Google's tiles).
export const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics";
export const SATELLITE_MAX_ZOOM = 19;

// Leaflet's default marker images are resolved relative to its own bundled
// CSS by default, which breaks under Next.js's bundler. Pointing the icon at
// a CDN copy of the package sidesteps that entirely — no bundler asset
// config needed.
export const MARKER_ICON_OPTIONS = {
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41] as [number, number],
  iconAnchor: [12, 41] as [number, number],
  popupAnchor: [1, -34] as [number, number],
  shadowSize: [41, 41] as [number, number],
};

// The green geofence circle drawn around every check-in location, on both
// the pin-picker (showing the boundary being set) and the overview map.
export const GEOFENCE_CIRCLE_STYLE = { color: "#2f6f5e", weight: 1, fillOpacity: 0.08 };
