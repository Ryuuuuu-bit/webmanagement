// Browser-side remembrance that a passkey has been used/registered here, so
// the login page goes straight to the Face ID / fingerprint prompt on the
// next visit — "open the app, look at it, you're in" — instead of showing
// a password form first. Purely a convenience hint: the password form is
// always one tap away, and clearing site data just falls back to it.
// Client-only helpers (localStorage); import from client components only.

const PASSKEY_HINT_KEY = "ts.passkeyLogin";

export function hasPasskeyHint() {
  try {
    return localStorage.getItem(PASSKEY_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPasskeyHint() {
  try {
    localStorage.setItem(PASSKEY_HINT_KEY, "1");
  } catch {
    // Private mode etc. — nothing to remember; the manual button still works.
  }
}
