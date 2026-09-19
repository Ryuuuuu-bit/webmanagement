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

type Loc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };

// Same icon (and same tile/circle styling, via mapConstants) as the
// pin-picker map (src/components/LocationPickerMap.tsx), so the two maps in
// this app look like one consistent thing rather than two different ones.
const markerIcon = L.icon(MARKER_ICON_OPTIONS);

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
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
      MAP_CENTER_THAILAND,
      MAP_ZOOM_THAILAND_WIDE
    );
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: OSM_MAX_ZOOM }).addTo(map);
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
        circle = L.circle(latLng, { radius: loc.radiusMeters, ...GEOFENCE_CIRCLE_STYLE }).addTo(map);
        circlesRef.current.set(loc.id, circle);
      } else {
        circle.setLatLng(latLng);
        circle.setRadius(loc.radiusMeters);
      }
    });

    if (!selectedId && locations.length > 0) {
      const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: MAP_ZOOM_FOCUSED });
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
      map.flyTo([loc.latitude, loc.longitude], MAP_ZOOM_FOCUSED, { duration: 0.6 });
      marker.openPopup();
    }
  }, [selectedId, locations]);

  return <div ref={containerRef} className={`w-full rounded-xl border border-line ${MAP_HEIGHT_CLASS}`} />;
}
