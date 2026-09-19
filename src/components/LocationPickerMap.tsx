"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MARKER_ICON_OPTIONS,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_MAX_ZOOM,
  MAP_CENTER_THAILAND,
  MAP_ZOOM_THAILAND_WIDE,
  MAP_ZOOM_FOCUSED,
  MAP_HEIGHT_CLASS,
  GEOFENCE_CIRCLE_STYLE,
} from "@/lib/mapConstants";

// Same icon (and same tile/circle styling, via mapConstants) as the
// all-locations overview map (src/components/LocationsMap.tsx), so the two
// maps in this app look like one consistent thing rather than two different
// ones.
const markerIcon = L.icon(MARKER_ICON_OPTIONS);

/**
 * A "drop a pin" map: click anywhere to place/move a draggable marker there
 * and report the coordinates back — the same convenience as Google Maps'
 * right-click-to-copy-coordinates flow, minus the copy/paste step, since the
 * lat/lng fields fill in directly. Free (Leaflet + OpenStreetMap tiles), no
 * API key. Also draws the same geofence circle the "all locations" map uses,
 * sized to the radius the admin is currently entering, so the boundary being
 * set is visible while placing the pin — not just after saving.
 */
export default function LocationPickerMap({
  latitude,
  longitude,
  radiusMeters,
  onChange,
  hint,
}: {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onChange: (lat: number, lng: number) => void;
  hint: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Remembers the last position WE emitted via onChange, so the effect that
  // syncs externally-changed lat/lng props (typed manually, or picked from
  // search) doesn't fight a click/drag that just set that same position.
  const lastEmitted = useRef<{ lat: number; lng: number } | null>(null);

  function placeMarker(map: L.Map, lat: number, lng: number) {
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: markerIcon, draggable: true }).addTo(map);
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current!.getLatLng();
        lastEmitted.current = { lat: pos.lat, lng: pos.lng };
        onChangeRef.current(pos.lat, pos.lng);
      });
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }

    if (!circleRef.current) {
      circleRef.current = L.circle([lat, lng], { radius: radiusMeters, ...GEOFENCE_CIRCLE_STYLE }).addTo(map);
    } else {
      circleRef.current.setLatLng([lat, lng]);
    }
  }

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const hasInitial = latitude != null && longitude != null;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
      hasInitial ? [latitude!, longitude!] : MAP_CENTER_THAILAND,
      hasInitial ? MAP_ZOOM_FOCUSED : MAP_ZOOM_THAILAND_WIDE
    );
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: OSM_MAX_ZOOM }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      placeMarker(map, e.latlng.lat, e.latlng.lng);
      lastEmitted.current = { lat: e.latlng.lat, lng: e.latlng.lng };
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    if (hasInitial) placeMarker(map, latitude!, longitude!);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker + view in sync when lat/lng change from OUTSIDE this map
  // (a search result was picked, or the admin typed into the number fields).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || latitude == null || longitude == null) return;
    if (lastEmitted.current && lastEmitted.current.lat === latitude && lastEmitted.current.lng === longitude) {
      return; // this position came from our own click/drag — already in sync
    }
    placeMarker(map, latitude, longitude);
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), MAP_ZOOM_FOCUSED), { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);

  // Keep the circle's radius in sync as the admin edits the radius field.
  useEffect(() => {
    circleRef.current?.setRadius(radiusMeters);
  }, [radiusMeters]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={containerRef} className={`w-full rounded-xl border border-line ${MAP_HEIGHT_CLASS}`} />
      <p className="text-[10px] text-faint">{hint}</p>
    </div>
  );
}
