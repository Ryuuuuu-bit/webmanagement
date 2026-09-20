"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkIn, checkOut } from "@/actions/attendance";
import { useLanguage } from "./LanguageProvider";

type Attendance = {
  status: string;
  checkinAt: string | null;
  checkoutAt: string | null;
} | null;

type Coords = { lat: number; lng: number };

export default function CheckinClient({ attendance }: { attendance: Attendance }) {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  // Only true during the rare fallback below (background fetch not ready
  // yet) — drives the "locating" text for that one case, since the normal
  // fast path never waits on GPS at all.
  const [locatingFallback, setLocatingFallback] = useState(false);
  // Holds the most recent GPS fix obtained in the background (see the effect
  // below). A ref, not state, on purpose: updates on every fix while the
  // watch runs, and reading it doesn't need to trigger a re-render.
  const coordsRef = useRef<Coords | null>(null);

  const canCheckin = !attendance?.checkinAt;
  const canCheckout = !!attendance?.checkinAt && !attendance?.checkoutAt;

  // Start reading the device's GPS position as soon as this page opens,
  // instead of waiting until the teacher taps check-in/out. A fresh GPS fix
  // can take several seconds (worse indoors, or right after opening the
  // app/phone) — teachers in a hurry were feeling that wait *after* tapping
  // the button. Fetching it in the background while they're just looking at
  // the screen means a fix is usually already available by the time they
  // tap, so the button submits immediately. `watchPosition` (rather than a
  // single `getCurrentPosition`) keeps refining/refreshing the fix for as
  // long as the page stays open, so it doesn't go stale if they linger.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {
        // Silent here — no error shown until the teacher actually tries to
        // check in/out and we still have nothing (handled in run() below),
        // so a slow/denied background fetch doesn't flash an error at them
        // before they've even touched a button.
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  function submit(
    action: (lat: number, lng: number) => Promise<{ ok: boolean; message: string }>,
    lat: number,
    lng: number
  ) {
    startTransition(async () => {
      const res = await action(lat, lng);
      setMessage(res.message);
    });
  }

  function run(action: (lat: number, lng: number) => Promise<{ ok: boolean; message: string }>) {
    setGeoError(null);
    setMessage(null);

    // Fast path: a position was already fetched in the background while the
    // page was open — submit right away, no GPS wait on this tap at all.
    if (coordsRef.current) {
      submit(action, coordsRef.current.lat, coordsRef.current.lng);
      return;
    }

    // Fallback: the background fetch hasn't returned a fix yet (e.g. the
    // button was tapped the instant the page loaded, or geolocation isn't
    // available) — fetch on demand like before.
    if (!("geolocation" in navigator)) {
      setGeoError(dict.checkin.geoUnsupported);
      return;
    }
    setLocatingFallback(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingFallback(false);
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        submit(action, pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocatingFallback(false);
        setGeoError(dict.checkin.geoError);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex gap-3">
        <button
          onClick={() => run(checkIn)}
          disabled={pending || locatingFallback || !canCheckin}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          📍 {dict.checkin.checkinButton}
        </button>
        <button
          onClick={() => run(checkOut)}
          disabled={pending || locatingFallback || !canCheckout}
          className="rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        >
          🚪 {dict.checkin.checkoutButton}
        </button>
      </div>
      {(pending || locatingFallback) && <p className="text-xs text-faint">{dict.checkin.locating}</p>}
      {message && <p className="text-sm font-medium text-brand-ink">{message}</p>}
      {geoError && <p className="text-sm text-danger">{geoError}</p>}
      <p className="max-w-xs text-xs text-faint">
        {dict.checkin.helpText}
      </p>
    </div>
  );
}
