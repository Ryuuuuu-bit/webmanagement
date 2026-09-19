"use client";

import { useState, useTransition } from "react";
import { checkIn, checkOut } from "@/actions/attendance";
import { useLanguage } from "./LanguageProvider";

type Attendance = {
  status: string;
  checkinAt: string | null;
  checkoutAt: string | null;
} | null;

export default function CheckinClient({ attendance }: { attendance: Attendance }) {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const canCheckin = !attendance?.checkinAt;
  const canCheckout = !!attendance?.checkinAt && !attendance?.checkoutAt;

  function run(action: (lat: number, lng: number) => Promise<{ ok: boolean; message: string }>) {
    setGeoError(null);
    setMessage(null);
    if (!("geolocation" in navigator)) {
      setGeoError(dict.checkin.geoUnsupported);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startTransition(async () => {
          const res = await action(pos.coords.latitude, pos.coords.longitude);
          setMessage(res.message);
        });
      },
      () => setGeoError(dict.checkin.geoError),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex gap-3">
        <button
          onClick={() => run(checkIn)}
          disabled={pending || !canCheckin}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          📍 {dict.checkin.checkinButton}
        </button>
        <button
          onClick={() => run(checkOut)}
          disabled={pending || !canCheckout}
          className="rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        >
          🚪 {dict.checkin.checkoutButton}
        </button>
      </div>
      {pending && <p className="text-xs text-faint">{dict.checkin.locating}</p>}
      {message && <p className="text-sm font-medium text-brand-ink">{message}</p>}
      {geoError && <p className="text-sm text-danger">{geoError}</p>}
      <p className="max-w-xs text-xs text-faint">
        {dict.checkin.helpText}
      </p>
    </div>
  );
}
