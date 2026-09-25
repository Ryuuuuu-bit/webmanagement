"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useLanguage } from "@/components/LanguageProvider";
import type { Draft, FlyTarget, MapLayer } from "@/components/LocationsWorkspaceMap";

// Leaflet touches `window` at import time — browser only.
const WorkspaceMap = dynamic(() => import("@/components/LocationsWorkspaceMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-page" />,
});

export type Loc = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workStart?: string | null;
  workEnd?: string | null;
  lateGraceMinutes?: number | null;
  teachers: number;
  rooms: number;
};
type ActionResult = { ok: boolean; message: string };
type SearchResult = { label: string; lat: number; lng: number };
type SearchAction = (query: string) => Promise<{ ok: boolean; message?: string; results?: SearchResult[] }>;

const RADIUS_MIN = 10;
const RADIUS_MAX = 2000;
const PRESETS = [50, 150, 300] as const;

const Icon = {
  plus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  close: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  edit: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>,
  trash: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>,
  locate: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>,
};

/**
 * Map-centric replacement for LocationManagement: one full-bleed map with
 * every site's geofence drawn on it, a floating list of sites, and a slide-in
 * panel for add/edit where the admin drops a pin, drags it onto the building
 * and sizes the radius with a slider while watching the circle on the map
 * (satellite view available). Same server actions as before.
 */
export default function LocationsWorkspace({
  locations,
  createLocation,
  updateLocation,
  deleteLocation,
  searchLocationCandidates,
}: {
  locations: Loc[];
  createLocation: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateLocation: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteLocation: (id: string) => Promise<ActionResult>;
  searchLocationCandidates: SearchAction;
}) {
  const { dict } = useLanguage();
  const t = dict.locations;
  const w = t.ws;
  const [pending, startTransition] = useTransition();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>("street");
  const [filter, setFilter] = useState("");
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const flyKey = useRef(0);
  const fly = (lat: number, lng: number, zoom = 16) => setFlyTarget({ lat, lng, zoom, key: ++flyKey.current });

  // Drawer (add / edit) state.
  const [drawer, setDrawer] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(150);
  const [name, setName] = useState("");
  const [workStart, setWorkStart] = useState("");
  const [workEnd, setWorkEnd] = useState("");
  const [grace, setGrace] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Toast.
  const [toast, setToast] = useState<ActionResult | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const mapLocs = useMemo(
    () => locations.map((l) => ({ id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, radiusMeters: l.radiusMeters, unused: l.teachers + l.rooms === 0 })),
    [locations]
  );
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? locations.filter((l) => l.name.toLowerCase().includes(q)) : locations;
  }, [locations, filter]);

  const draft: Draft | null = pin ? { lat: pin.lat, lng: pin.lng, radius, label: name.trim() || w.newPinLabel } : null;

  function openDrawer(loc: Loc | null) {
    setDrawer(loc ? { mode: "edit", id: loc.id } : { mode: "add" });
    setPin(loc ? { lat: loc.latitude, lng: loc.longitude } : null);
    setRadius(loc ? loc.radiusMeters : 150);
    setName(loc ? loc.name : "");
    setWorkStart(loc?.workStart ?? "");
    setWorkEnd(loc?.workEnd ?? "");
    setGrace(loc?.lateGraceMinutes != null ? String(loc.lateGraceMinutes) : "");
    setQuery("");
    setResults(null);
    setSearchError(null);
    if (loc) {
      setSelectedId(loc.id);
      fly(loc.latitude, loc.longitude, 17);
    }
  }
  function closeDrawer() {
    setDrawer(null);
    setPin(null);
  }

  function selectSite(id: string) {
    setSelectedId(id);
    const loc = locations.find((l) => l.id === id);
    if (loc) fly(loc.latitude, loc.longitude, 16);
  }

  async function runSearch() {
    const q = query.trim();
    if (q.length < 3) {
      setSearchError(t.search.tooShort);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const res = await searchLocationCandidates(q);
    setSearching(false);
    if (!res.ok) {
      setSearchError(res.message ?? t.search.error);
      setResults(null);
      return;
    }
    setResults(res.results ?? []);
  }
  function pickResult(r: SearchResult) {
    setPin({ lat: r.lat, lng: r.lng });
    if (!name.trim()) setName(r.label.split(",")[0].trim());
    setResults(null);
    setQuery(r.label);
    fly(r.lat, r.lng, 17);
  }
  function useMyLocation() {
    if (!navigator.geolocation) {
      setToast({ ok: false, message: w.geoUnsupported });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPin({ lat: p.coords.latitude, lng: p.coords.longitude });
        fly(p.coords.latitude, p.coords.longitude, 18);
      },
      () => setToast({ ok: false, message: w.geoFailed }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function save() {
    if (!drawer) return;
    if (!pin) {
      setToast({ ok: false, message: w.pinFirst });
      return;
    }
    const fd = new FormData();
    fd.set("name", name);
    fd.set("latitude", String(pin.lat));
    fd.set("longitude", String(pin.lng));
    fd.set("radiusMeters", String(radius));
    fd.set("workStart", workStart);
    fd.set("workEnd", workEnd);
    fd.set("lateGraceMinutes", grace);
    const editId = drawer.mode === "edit" ? drawer.id : null;
    startTransition(async () => {
      const res = editId ? await updateLocation(editId, null, fd) : await createLocation(null, fd);
      setToast(res);
      if (res.ok) {
        closeDrawer();
        if (editId) setSelectedId(editId);
      }
    });
  }

  function remove(loc: Loc) {
    if (!confirm(t.deleteConfirm(loc.name))) return;
    startTransition(async () => {
      const res = await deleteLocation(loc.id);
      setToast(res);
      if (res.ok && selectedId === loc.id) setSelectedId(null);
    });
  }

  const drawerOpen = drawer !== null;
  const drawerTitle = drawer?.mode === "edit" ? w.drawerEditTitle(locations.find((l) => l.id === drawer.id)?.name ?? "") : w.drawerAddTitle;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-3rem)] lg:min-h-[560px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{w.title}</h1>
          <p className="mt-1 text-sm text-muted">{w.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-line bg-surface text-xs">
            {(["street", "satellite"] as MapLayer[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayer(l)}
                className={`px-3.5 py-1.5 font-semibold ${layer === l ? "bg-brand text-white" : "text-muted hover:text-ink"}`}
              >
                {l === "street" ? w.layerStreet : w.layerSatellite}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => openDrawer(null)}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {Icon.plus}
            {t.addButton}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 lg:block lg:overflow-hidden">
        {/* Map. `isolate z-0` gives Leaflet its own stacking context: its
            panes/controls use z-index 400–1000 internally, which otherwise
            compete with the app shell (mobile menu overlay is z-50) and the
            map painted on top of the open sidebar. Everything on this page
            that must float above the map is a sibling of this box, not a
            child, and uses small z-indexes (list z-10, panel z-20, bottom
            sheet / toast z-40 — above the sticky header z-30, below the
            menu z-50). */}
        <div className="relative isolate z-0 h-[320px] overflow-hidden rounded-2xl border border-line sm:h-[380px] lg:absolute lg:inset-0 lg:h-auto">
          <WorkspaceMap
            locations={mapLocs}
            selectedId={selectedId}
            hiddenId={drawer?.mode === "edit" ? drawer.id : null}
            draft={draft}
            pickMode={drawerOpen}
            layer={layer}
            flyTarget={flyTarget}
            onMapClick={(lat, lng) => {
              if (drawerOpen) setPin({ lat, lng });
            }}
            onDraftMove={(lat, lng) => setPin({ lat, lng })}
            onSelect={selectSite}
          />
          <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-muted shadow-lg">
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2f9e86]" />{w.legendInUse}</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#e2984b]" />{w.legendUnused}</div>
          </div>
        </div>

        {/* Site list */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm lg:absolute lg:bottom-4 lg:left-4 lg:top-4 lg:z-10 lg:w-[340px] lg:shadow-xl">
          <div className="border-b border-line px-4 pb-3 pt-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold">{w.listTitle}</div>
              <span className="rounded-full bg-page px-2.5 py-0.5 text-[11px] text-muted">{w.count(locations.length)}</span>
            </div>
            <div className="relative mt-2.5">
              <span className="pointer-events-none absolute left-3 top-2.5 text-muted">{Icon.search}</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={w.filterPlaceholder} className="input w-full rounded-full !pl-9 text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 max-lg:max-h-[360px]">
            {locations.length === 0 && <p className="px-1 py-2 text-sm text-danger">{t.none}</p>}
            {locations.length > 0 && filtered.length === 0 && <p className="px-1 py-2 text-sm text-faint">{w.filterEmpty}</p>}
            {filtered.map((loc) => {
              const unused = loc.teachers + loc.rooms === 0;
              const sel = loc.id === selectedId;
              return (
                <div
                  key={loc.id}
                  onClick={() => selectSite(loc.id)}
                  className={`mb-2.5 cursor-pointer rounded-xl border p-3 transition-colors hover:border-brand ${sel ? "border-brand bg-brand-soft" : "border-line"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${unused ? "bg-[#e2984b]" : "bg-[#2f9e86]"}`} />
                      <span className={`truncate text-sm ${sel ? "font-bold" : "font-medium"}`}>{loc.name}</span>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label={dict.common.edit}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(loc);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted hover:bg-page hover:text-ink"
                      >
                        {Icon.edit}
                      </button>
                      <button
                        type="button"
                        aria-label={dict.common.delete}
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(loc);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-muted hover:border-danger hover:text-danger disabled:opacity-40"
                      >
                        {Icon.trash}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 text-xs text-muted">
                    {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)} · {t.radiusLabel} {loc.radiusMeters} {t.metersShort}
                    {(loc.workStart || loc.workEnd) && ` · ${loc.workStart || "…"}–${loc.workEnd || "…"}`}
                    {loc.lateGraceMinutes != null && ` (+${loc.lateGraceMinutes})`}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {unused ? (
                      <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] text-warn">{w.badgeUnused}</span>
                    ) : (
                      <>
                        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] text-brand-ink">{w.badgeTeachers(loc.teachers)}</span>
                        <span className="rounded-full bg-page px-2.5 py-0.5 text-[11px] text-muted">{w.badgeRooms(loc.rooms)}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Add / edit drawer — bottom sheet on phones, side panel on desktop */}
        <section
          aria-hidden={!drawerOpen}
          className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl transition-[transform,visibility] duration-300 lg:absolute lg:z-20 lg:inset-auto lg:bottom-4 lg:right-4 lg:top-4 lg:w-[380px] lg:max-h-none lg:rounded-2xl ${
            drawerOpen ? "visible translate-y-0 lg:translate-x-0" : "invisible translate-y-full lg:translate-x-[120%] lg:translate-y-0"
          }`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold">{drawerTitle}</h2>
              <p className="mt-0.5 text-xs text-muted">{w.drawerHint}</p>
            </div>
            <button type="button" aria-label={dict.common.cancel} onClick={closeDrawer} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-page hover:text-ink">
              {Icon.close}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {/* Search */}
            <div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2.5 text-muted">{Icon.search}</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runSearch();
                    }
                  }}
                  placeholder={w.searchPlaceholder}
                  className="input w-full rounded-full !pl-9 text-sm"
                />
              </div>
              {searching && <p className="mt-1.5 text-xs text-faint">{w.searching}</p>}
              {searchError && <p className="mt-1.5 text-xs text-danger">{searchError}</p>}
              {results && results.length === 0 && !searchError && <p className="mt-1.5 text-xs text-faint">{t.search.noResults}</p>}
              {results && results.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {results.map((r, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => pickResult(r)} className="w-full rounded-lg border border-line px-3 py-2 text-left text-xs text-subtle hover:border-brand">
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[10px] text-faint">
                {t.search.attributionPrefix} Google {t.search.attributionSuffix}
              </p>
            </div>

            {/* Pin status */}
            <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${pin ? "border-brand bg-brand-soft" : "border-dashed border-line-strong bg-page"}`}>
              <div className="min-w-0">
                <div className="text-xs font-semibold">{pin ? w.pinned : w.notPinned}</div>
                <div className="truncate text-[11px] text-muted">{pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : w.notPinnedHint}</div>
              </div>
              <button type="button" onClick={useMyLocation} className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-page">
                {Icon.locate}
                {w.myLocation}
              </button>
            </div>

            {/* Name */}
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">{w.nameLabel}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={w.namePlaceholder} className="input w-full min-w-0" />
            </label>

            {/* Lat / lng (editable for the copy-paste-from-Google-Maps path) */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">{t.latitudePlaceholder}</span>
                <input
                  type="number"
                  step="any"
                  value={pin ? pin.lat.toFixed(6) : ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value !== "" && Number.isFinite(v)) setPin({ lat: v, lng: pin?.lng ?? 100.5018 });
                  }}
                  className="input w-full tabular-nums"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">{t.longitudePlaceholder}</span>
                <input
                  type="number"
                  step="any"
                  value={pin ? pin.lng.toFixed(6) : ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value !== "" && Number.isFinite(v)) setPin({ lat: pin?.lat ?? 13.7563, lng: v });
                  }}
                  className="input w-full tabular-nums"
                />
              </label>
            </div>

            {/* Radius */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted">{w.radiusLabel}</span>
                <span className="text-sm tabular-nums">
                  <b>{radius}</b> {t.metersShort}
                </span>
              </div>
              <input
                type="range"
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                step={10}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="mt-2 w-full accent-brand"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESETS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadius(r)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${radius === r ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-muted hover:text-ink"}`}
                  >
                    {r === 50 ? w.presetSingle : r === 150 ? w.presetCluster : w.presetCampus}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-faint">{w.radiusHint}</p>
            </div>

            {/* Working hours */}
            <div>
              <span className="mb-1 block text-[11px] text-muted">{t.hoursLabel}</span>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_76px] gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-faint">{t.hoursStart}</span>
                  <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} className="input w-full min-w-0" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-faint">{t.hoursEnd}</span>
                  <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className="input w-full min-w-0" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-faint">{t.hoursGrace}</span>
                  <input type="number" min={0} max={180} value={grace} onChange={(e) => setGrace(e.target.value)} placeholder="—" className="input w-full min-w-0" />
                </label>
              </div>
              <p className="mt-1 text-[11px] text-faint">{t.hoursHint}</p>
            </div>
          </div>

          <div className="flex gap-2 border-t border-line px-5 py-3.5">
            <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-page">
              {dict.common.cancel}
            </button>
            <button type="button" onClick={save} disabled={pending || !pin} className="flex-[2] rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pending ? dict.common.saving : w.save}
            </button>
          </div>
        </section>

        {/* Toast */}
        {toast && (
          <div
            role="status"
            className={`pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg border bg-surface px-4 py-2.5 text-sm shadow-xl lg:absolute ${toast.ok ? "border-line text-brand-ink" : "border-danger text-danger"}`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}
