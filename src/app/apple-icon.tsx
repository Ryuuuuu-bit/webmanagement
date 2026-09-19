import { ImageResponse } from "next/og";

// Next.js file convention: auto-injects <link rel="apple-touch-icon">.
// No border-radius here — iOS applies its own rounded-square mask on top,
// so a square fill is what other apple-touch-icons expect.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 76,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        TS
      </div>
    ),
    { ...size }
  );
}
