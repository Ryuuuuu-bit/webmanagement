"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const THAILAND_CENTER: [number, number] = [13.7563, 100.5018];
const THAILAND_ZOOM = 6;
const PICKED_ZOOM = 16;

/**
 * A "drop a pin" map: click anywhere to place/move a draggable marker there
 * and report the coordinates back — the same convenience as Google Maps'
 * right-click-to-copy-coordinates flow, minus the copy/paste step, since the
 * lat/lng fields fill in directly. Free (Leaflet + OpenStreetMap tiles), no
 * API key.
 */
export default function LocationPickerMap({
  latitude,
  longitude,
  onChange,
  hint,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  hint: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
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
  }

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const hasInitial = latitude != null && longitude != null;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
      hasInitial ? [latitude!, longitude!] : THAILAND_CENTER,
      hasInitial ? PICKED_ZOOM : THAILAND_ZOOM
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

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
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), PICKED_ZOOM), { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={containerRef} className="h-[260px] w-full rounded-xl border border-line" />
      <p className="text-[10px] text-faint">{hint}</p>
    </div>
  );
}
