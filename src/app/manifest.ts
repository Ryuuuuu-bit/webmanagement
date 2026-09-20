import type { MetadataRoute } from "next";

// Next.js file convention: served at /manifest.webmanifest, and the
// <link rel="manifest"> tag is injected into <head> automatically — no
// change needed in layout.tsx for that part.
//
// start_url points straight at /checkin (not /dashboard) because the whole
// point of installing this as a home-screen app is to make check-in/out a
// single tap: open the icon, you're already on the check-in screen. It works
// for admins too — /checkin renders the admin overview table for them
// instead of the check-in buttons (see src/app/(app)/checkin/page.tsx).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeachSchedule",
    short_name: "TeachSchedule",
    description: "ระบบตารางสอนและเช็คอิน-เอาต์สำหรับอาจารย์",
    lang: "th",
    start_url: "/checkin",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f6f5e",
    icons: [
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/api/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png" },
      { src: "/api/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home-screen icon (Android) → jump straight to these.
    shortcuts: [
      { name: "เช็คอิน / เช็คเอาต์", short_name: "เช็คอิน", url: "/checkin" },
      { name: "ตารางสอนของฉัน", short_name: "ตารางสอน", url: "/schedule" },
      { name: "ขอลา", short_name: "ขอลา", url: "/leave" },
    ],
  };
}
