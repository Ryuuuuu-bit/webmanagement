"use client";

import { useEffect } from "react";

// Registers the no-op service worker (public/sw.js) that Chrome/Android
// require before offering "Add to Home Screen". Renders nothing — this is
// pure side effect, and safe to no-op on browsers without the API (e.g. iOS
// Safari before 11.3) or when it's blocked.
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
