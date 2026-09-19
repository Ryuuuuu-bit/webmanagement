"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type Loc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };
type ActionResult = { ok: boolean; message: string };
type SearchResult = { label: string; lat: number; lng: number };
type SearchActionResult = { ok: boolean; message?: string; results?: SearchResult[] };
type SearchAction = (query: string) => Promise<SearchActionResult>;

/**
 * Search-by-name box backed by OpenStreetMap's free Nominatim API. Only fires
 * on an explicit click / Enter — never on every keystroke — per Nominatim's
 * usage policy (see src/lib/geocode.ts for details).
 */
function PlaceSearchBox({
  searchAction,
  onSelect,
  dict,
}: {
  searchAction: SearchAction;
  onSelect: (r: SearchResult) => void;
  dict: Dictionary;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 3) {
      setError(dict.locations.search.tooShort);
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await searchAction(q);
    setLoading(false);
    if (!res.ok) {
      setError(res.message ?? dict.locations.search.error);
      setResults(null);
      return;
    }
    setResults(res.results ?? []);
  }

  return (
    <div className="rounded-lg border border-line-soft bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder={dict.locations.search.placeholder}
          className="input min-w-[220px] flex-1"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={loading}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-60"
        >
          {loading ? dict.common.saving : dict.locations.search.button}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {results && results.length === 0 && !error && (
        <p className="mt-2 text-xs text-faint">{dict.locations.search.noResults}</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setResults(null);
                  setQuery(r.label);
                }}
                className="w-full rounded-md px-2 py-1 text-left text-xs text-subtle hover:bg-surface"
              >
                📍 {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-faint">{dict.locations.search.attribution}</p>
    </div>
  );
}

function LocationEditRow({
  loc,
  dict,
  pending,
  searchLocationCandidates,
  onSubmit,
  onCancel,
  errorMessage,
}: {
  loc: Loc;
  dict: Dictionary;
  pending: boolean;
  searchLocationCandidates: SearchAction;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  errorMessage?: string;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <PlaceSearchBox
        searchAction={searchLocationCandidates}
        dict={dict}
        onSelect={(r) => {
          if (latRef.current) latRef.current.value = String(r.lat);
          if (lngRef.current) lngRef.current.value = String(r.lng);
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
        <input ref={nameRef} name="name" required defaultValue={loc.name} className="input" />
        <input ref={latRef} name="latitude" required type="number" step="any" defaultValue={loc.latitude} className="input" />
        <input ref={lngRef} name="longitude" required type="number" step="any" defaultValue={loc.longitude} className="input" />
        <input name="radiusMeters" required type="number" defaultValue={loc.radiusMeters} min={10} max={20000} className="input" />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
          <button type="button" onClick={onCancel} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
        </div>
      </div>
      {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
    </form>
  );
}

export default function LocationManagement({
  locations,
  createLocation,
  updateLocation,
  deleteLocation,
  searchLocationCandidates,
}: {
  locations: Loc[];
  createLocation: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateLocation: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteLocation: (id: string) => Promise<void>;
  searchLocationCandidates: SearchAction;
}) {
  const { dict } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ id: string } & ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLocation(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateLocation(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(dict.locations.deleteConfirm(name))) return;
    startTransition(() => deleteLocation(id));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.locations.addTitle}</h2>
        <p className="mt-1 text-sm text-muted">
          {dict.locations.addHint}
        </p>
        <form ref={formRef} onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <PlaceSearchBox
            searchAction={searchLocationCandidates}
            dict={dict}
            onSelect={(r) => {
              if (latRef.current) latRef.current.value = String(r.lat);
              if (lngRef.current) lngRef.current.value = String(r.lng);
              // r.label is OSM's full display_name (name + full address) — only the
              // first segment is the actual place name, so use just that as the
              // suggested location name rather than the whole address string.
              if (nameRef.current && !nameRef.current.value.trim()) nameRef.current.value = r.label.split(",")[0].trim();
            }}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <input ref={nameRef} name="name" required placeholder={dict.locations.namePlaceholder} className="input" />
            <input ref={latRef} name="latitude" required type="number" step="any" placeholder={dict.locations.latitudePlaceholder} className="input" />
            <input ref={lngRef} name="longitude" required type="number" step="any" placeholder={dict.locations.longitudePlaceholder} className="input" />
            <input name="radiusMeters" required type="number" defaultValue={150} min={10} max={20000} placeholder={dict.locations.radiusPlaceholder} className="input" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? dict.common.saving : dict.locations.addButton}
            </button>
            {createResult && (
              <span className={`text-sm ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.locations.allTitle}</h2>
        {locations.length === 0 && (
          <p className="mt-2 text-sm text-danger">{dict.locations.none}</p>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {locations.map((loc) =>
            editingId === loc.id ? (
              <LocationEditRow
                key={loc.id}
                loc={loc}
                dict={dict}
                pending={pending}
                searchLocationCandidates={searchLocationCandidates}
                onSubmit={(e) => onEditSubmit(loc.id, e)}
                onCancel={() => setEditingId(null)}
                errorMessage={editResult?.id === loc.id && !editResult.ok ? editResult.message : undefined}
              />
            ) : (
              <div key={loc.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-sm first:border-t-0 first:pt-0">
                <div>
                  <span className="font-semibold">{loc.name}</span>
                  <span className="ml-2 text-faint">
                    ({loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}) {dict.locations.radiusLabel} {loc.radiusMeters} {dict.locations.metersShort}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setEditingId(loc.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                  <button disabled={pending} onClick={() => onDelete(loc.id, loc.name)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
