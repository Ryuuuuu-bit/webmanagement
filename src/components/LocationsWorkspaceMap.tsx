"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_MAX_ZOOM,
  SATELLITE_TILE_URL,
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  MAP_CENTER_THAILAND,
  MAP_ZOOM_THAILAND_WIDE,
  MAP_ZOOM_FOCUSED,
} from "@/lib/mapConstants";

export type WorkspaceLoc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; unused: boolean };
export type Draft = { lat: number; lng: number; radius: number; label: string };
export type FlyTarget = { lat: number; lng: number; zoom: number; key: number };
export type MapLayer = "street" | "satellite";

const IN_USE = "#2f9e86";
const UNUSED = "#e2984b";

function labelIcon(text: string, kind: "normal" | "selected" | "draft") {
  const base =
    "display:inline-block;padding:3px 9px;border-radius:7px;font-size:11px;white-space:nowrap;box-shadow:0 6px 16px rgba(0,0,0,.25);font-family:inherit;";
  const style =
    kind === "draft"
      ? `${base}background:${IN_USE};color:#fff;font-weight:700;`
      : kind === "selected"
      ? `${base}background:#fff;color:#1b231f;border:1.5px solid ${IN_USE};font-weight:700;`
      : `${base}background:#fff;color:#1b231f;border:1px solid rgba(0,0,0,.15);font-weight:500;`;
  const safe = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  return L.divIcon({ className: "", html: `<div style="${style}">${safe}</div>`, iconAnchor: [0, 36] });
}

function dotIcon(color: string, big: boolean) {
  const s = big ? 18 : 14;
  return L.divIcon({
    className: "",
    html: `<div style="width:${s}px;height:${s}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 0 0 ${big ? 4 : 1}px ${color}55, 0 2px 6px rgba(0,0,0,.35)"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

/**
 * The one map on the locations workspace: every saved site (dot + geofence
 * circle + name label), the site being placed/edited as a draggable "draft"
 * pin whose circle follows the radius slider live, and a street/satellite
 * switch so the admin can check the circle really covers the building.
 * Purely imperative Leaflet behind React props — Leaflet owns the DOM here.
 */
export default function LocationsWorkspaceMap({
  locations,
  selectedId,
  hiddenId,
  draft,
  pickMode,
  layer,
  flyTarget,
  onMapClick,
  onDraftMove,
  onSelect,
}: {
  locations: WorkspaceLoc[];
  selectedId: string | null;
  /** Site currently being edited — its saved circle is hidden so only the draft shows. */
  hiddenId: string | null;
  draft: Draft | null;
  pickMode: boolean;
  layer: MapLayer;
  flyTarget: FlyTarget | null;
  onMapClick: (lat: number, lng: number) => void;
  onDraftMove: (lat: number, lng: number) => void;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const streetRef = useRef<L.TileLayer | null>(null);
  const satRef = useRef<L.TileLayer | null>(null);
  const sitesRef = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef<L.LayerGroup | null>(null);
  const draftMarkerRef = useRef<L.Marker | null>(null);
  const draftCircleRef = useRef<L.Circle | null>(null);
  const didFitRef = useRef(false);
  const cb = useRef({ onMapClick, onDraftMove, onSelect });
  cb.current = { onMapClick, onDraftMove, onSelect };

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false }).setView(MAP_CENTER_THAILAND, MAP_ZOOM_THAILAND_WIDE);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    streetRef.current = L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: OSM_MAX_ZOOM }).addTo(map);
    satRef.current = L.tileLayer(SATELLITE_TILE_URL, { attribution: SATELLITE_ATTRIBUTION, maxZoom: SATELLITE_MAX_ZOOM });
    sitesRef.current = L.layerGroup().addTo(map);
    draftRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => cb.current.onMapClick(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;

    // The container changes size between the phone (stacked) and desktop
    // (full-bleed) layouts and when the sidebar collapses — keep tiles aligned.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      draftMarkerRef.current = null;
      draftCircleRef.current = null;
    };
  }, []);

  // Street / satellite.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !streetRef.current || !satRef.current) return;
    const show = layer === "satellite" ? satRef.current : streetRef.current;
    const hide = layer === "satellite" ? streetRef.current : satRef.current;
    if (map.hasLayer(hide)) map.removeLayer(hide);
    if (!map.hasLayer(show)) show.addTo(map);
  }, [layer]);

  // Saved sites: redraw whenever the list or the selection changes (cheap
  // at this scale — a handful of sites, not thousands).
  useEffect(() => {
    const map = mapRef.current;
    const group = sitesRef.current;
    if (!map || !group) return;
    group.clearLayers();
    for (const loc of locations) {
      if (loc.id === hiddenId) continue;
      const color = loc.unused ? UNUSED : IN_USE;
      const sel = loc.id === selectedId;
      const pos: [number, number] = [loc.latitude, loc.longitude];
      const circle = L.circle(pos, {
        radius: loc.radiusMeters,
        color,
        weight: sel ? 2.5 : 1.2,
        fillColor: color,
        fillOpacity: sel ? 0.22 : 0.1,
        dashArray: loc.unused ? "4 4" : undefined,
      }).addTo(group);
      const dot = L.marker(pos, { icon: dotIcon(color, sel), keyboard: false }).addTo(group);
      L.marker(pos, { icon: labelIcon(loc.name, sel ? "selected" : "normal"), interactive: false, keyboard: false }).addTo(group);
      const pick = () => cb.current.onSelect(loc.id);
      circle.on("click", pick);
      dot.on("click", pick);
    }
    if (!didFitRef.current && locations.length > 0) {
      didFitRef.current = true;
      // On desktop the site list floats over the left ~360px of the map —
      // keep the fitted sites out from under it.
      const wide = map.getSize().x >= 900;
      map.fitBounds(L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number])), {
        paddingTopLeft: [wide ? 400 : 40, 60],
        paddingBottomRight: [60, 60],
        maxZoom: MAP_ZOOM_FOCUSED,
      });
    }
  }, [locations, selectedId, hiddenId]);

  // Draft pin (add / edit): draggable marker + live-radius circle + label.
  useEffect(() => {
    const map = mapRef.current;
    const group = draftRef.current;
    if (!map || !group) return;
    if (!draft) {
      group.clearLayers();
      draftMarkerRef.current = null;
      draftCircleRef.current = null;
      return;
    }
    const pos: [number, number] = [draft.lat, draft.lng];
    if (!draftMarkerRef.current) {
      group.clearLayers();
      draftCircleRef.current = L.circle(pos, { radius: draft.radius, color: IN_USE, weight: 2, fillColor: IN_USE, fillOpacity: 0.18 }).addTo(group);
      const marker = L.marker(pos, { icon: dotIcon(IN_USE, true), draggable: true, zIndexOffset: 1000 }).addTo(group);
      marker.on("drag", () => draftCircleRef.current?.setLatLng(marker.getLatLng()));
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        cb.current.onDraftMove(p.lat, p.lng);
      });
      draftMarkerRef.current = marker;
    } else {
      draftMarkerRef.current.setLatLng(pos);
      draftCircleRef.current?.setLatLng(pos);
      draftCircleRef.current?.setRadius(draft.radius);
    }
    // Label is rebuilt each time (cheap) so a name typed in the form shows up on the pin.
    group.eachLayer((l) => {
      if (l !== draftMarkerRef.current && l !== draftCircleRef.current) group.removeLayer(l);
    });
    L.marker(pos, { icon: labelIcon(draft.label, "draft"), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(group);
  }, [draft]);

  // Crosshair while placing a pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  // Fly requests (card clicked, search result picked, geolocation).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    map.flyTo([flyTarget.lat, flyTarget.lng], Math.max(map.getZoom(), flyTarget.zoom), { duration: 0.6 });
  }, [flyTarget]);

  return <div ref={containerRef} className="h-full w-full" />;
}
