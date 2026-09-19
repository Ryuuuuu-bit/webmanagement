import { ImageResponse } from "next/og";

// Next.js App Router file convention: this generates the site favicon at
// build time, matching the "TS" brand badge used in the sidebar and on the
// login/change-password pages (same background color, same monogram).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2f6f5e",
          color: "#ffffff",
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 7,
        }}
      >
        TS
      </div>
    ),
    { ...size }
  );
}
