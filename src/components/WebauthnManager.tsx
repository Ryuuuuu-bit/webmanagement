"use client";

import { useState } from "react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  startWebauthnRegistration,
  finishWebauthnRegistration,
  deleteMyCredential,
  listMyCredentials,
  type WebauthnCredentialRow,
} from "@/actions/webauthn";
import { useLanguage } from "./LanguageProvider";
import { formatDate, formatTime } from "@/lib/date";
import { rememberPasskeyHint } from "@/lib/passkeyHint";

/**
 * Lets a teacher register their own device's fingerprint/Face ID (a
 * WebAuthn "platform authenticator") for use as identity verification at
 * check-in/out — see CheckinClient.tsx — and manage/remove devices they've
 * already registered. Purely opt-in from the teacher's side; check-in/out
 * itself falls back to a password prompt for anyone with nothing
 * registered here yet, or on a device that can't do platform biometrics.
 */
export default function WebauthnManager({
  initialCredentials,
  approvalRequired,
}: {
  initialCredentials: WebauthnCredentialRow[];
  approvalRequired: boolean;
}) {
  const { dict, locale } = useLanguage();
  const [credentials, setCredentials] = useState(initialCredentials);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onAddDevice() {
    setError(null);
    setSuccess(null);
    if (!browserSupportsWebAuthn()) {
      setError(dict.checkin.webauthnUnsupported);
      return;
    }
    setBusy(true);
    try {
      const options = await startWebauthnRegistration();
      const response = await startRegistration({ optionsJSON: options });
      const res = await finishWebauthnRegistration(response, label);
      if (res.ok) {
        // This browser now has a passkey — let the login page lead with it.
        rememberPasskeyHint();
        setSuccess(res.message);
        setLabel("");
        setCredentials(await listMyCredentials());
      } else {
        setError(res.message);
      }
    } catch (err) {
      // A server-side refusal (device limit) carries its own message;
      // otherwise the prompt was cancelled / no platform authenticator.
      const msg = err instanceof Error && err.message && !/Error:|NotAllowed/i.test(err.message) ? err.message : dict.actions.webauthn.verifyFailed;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string, displayLabel: string) {
    if (!confirm(dict.checkin.removeDeviceConfirm(displayLabel))) return;
    setError(null);
    setBusy(true);
    const res = await deleteMyCredential(id);
    setBusy(false);
    if (res.ok) {
      setCredentials((prev) => prev.filter((c) => c.id !== id));
      setSuccess(res.message);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.checkin.deviceSectionTitle}</h2>
      <p className="mt-1 text-sm text-muted">{dict.checkin.deviceSectionHint}</p>
      <p className="mt-1 text-xs text-faint">{approvalRequired ? dict.checkin.deviceRuleApproval : dict.checkin.deviceRuleNoApproval}</p>

      {credentials.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{dict.checkin.noDevices}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-line-soft px-3 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {c.label || dict.checkin.unnamedDevice}
                  {c.pending && <span className="ml-2 badge bg-warn-soft text-warn">{dict.checkin.devicePendingBadge}</span>}
                </p>
                <p className="text-xs text-faint">
                  {c.lastUsedAt
                    ? dict.checkin.deviceLastUsed(
                        `${formatDate(c.lastUsedAt, locale)} ${formatTime(new Date(c.lastUsedAt), locale)}`
                      )
                    : dict.checkin.deviceNeverUsed}
                </p>
              </div>
              <button
                onClick={() => onRemove(c.id, c.label || dict.checkin.unnamedDevice)}
                disabled={busy}
                className="text-xs font-semibold text-danger underline disabled:opacity-40"
              >
                {dict.checkin.removeDevice}
              </button>
            </li>
          ))}
        </ul>
      )}

      {credentials.length > 0 && <p className="mt-3 text-xs text-faint">{dict.checkin.deviceLimitHint}</p>}
      <div className={`mt-4 flex flex-col gap-2 sm:flex-row ${credentials.length > 0 ? "hidden" : ""}`}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={dict.checkin.deviceLabelPlaceholder}
          disabled={busy}
          className="input flex-1"
        />
        <button
          onClick={onAddDevice}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? dict.checkin.addingDevice : dict.checkin.addDeviceButton}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {success && <p className="mt-2 text-sm text-brand-ink">{success}</p>}
    </div>
  );
}
