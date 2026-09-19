"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Loc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };

// Leaflet's default marker images are resolved relative to its own bundled
// CSS by default, which breaks under Next.js's bundler. Pointing the icon at
// the same CDN copy of the package sidesteps that entirely — no bundler
// asset config needed, and it's the same free OpenStreetMap-ecosystem stack
// already used for place search (src/lib/geocode.ts).
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DEFAULT_CENTER: [number, number] = [13.7563, 100.5018]; // Bangkok
const DEFAULT_ZOOM = 11;

export default function LocationsMap({
  locations,
  selectedId,
  radiusLabel,
  metersShort,
}: {
  locations: Loc[];
  selectedId: string | null;
  radiusLabel: string;
  metersShort: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<globalThis.Map<string, L.Marker>>(new globalThis.Map());
  const circlesRef = useRef<globalThis.Map<string, L.Circle>>(new globalThis.Map());

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep markers/geofence circles in sync with the locations list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(locations.map((l) => l.id));
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    for (const [id, circle] of circlesRef.current) {
      if (!currentIds.has(id)) {
        circle.remove();
        circlesRef.current.delete(id);
      }
    }

    locations.forEach((loc) => {
      const latLng: [number, number] = [loc.latitude, loc.longitude];

      let marker = markersRef.current.get(loc.id);
      if (!marker) {
        marker = L.marker(latLng, { icon: markerIcon }).addTo(map);
        markersRef.current.set(loc.id, marker);
      } else {
        marker.setLatLng(latLng);
      }
      marker.bindPopup(`<strong>${loc.name}</strong><br/>${radiusLabel} ${loc.radiusMeters} ${metersShort}`);

      let circle = circlesRef.current.get(loc.id);
      if (!circle) {
        circle = L.circle(latLng, { radius: loc.radiusMeters, color: "#2f6f5e", weight: 1, fillOpacity: 0.08 }).addTo(map);
        circlesRef.current.set(loc.id, circle);
      } else {
        circle.setLatLng(latLng);
        circle.setRadius(loc.radiusMeters);
      }
    });

    if (!selectedId && locations.length > 0) {
      const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  // Fly to + open the popup for whichever location is selected in the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const loc = locations.find((l) => l.id === selectedId);
    const marker = markersRef.current.get(selectedId);
    if (loc && marker) {
      map.flyTo([loc.latitude, loc.longitude], 16, { duration: 0.6 });
      marker.openPopup();
    }
  }, [selectedId, locations]);

  return <div ref={containerRef} className="h-[420px] w-full rounded-xl border border-line" />;
}
