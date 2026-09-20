"use client";

/**
 * Stable random id for this browser installation (per origin). Lives in
 * localStorage and is mirrored into a cookie so server code — check-in,
 * login, the audit log — can see which *installation* a request came from,
 * which an IP address can't tell you (phones hop between 4G and Wi-Fi).
 * It is not a hardware id: clearing site data or reinstalling the PWA
 * gives a new one, which is exactly what a web app is allowed to have.
 */
export const DEVICE_ID_KEY = "ts.deviceInstallId";
export const DEVICE_ID_COOKIE = "ts_did";

export function getDeviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    // Refresh the cookie every time so it never silently expires before
    // the localStorage copy does.
    document.cookie = `${DEVICE_ID_COOKIE}=${id}; Path=/; Max-Age=${60 * 60 * 24 * 400}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    return id;
  } catch {
    return null;
  }
}
