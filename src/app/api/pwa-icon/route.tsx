import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

// Generates the larger PNG icons the PWA manifest needs (192x192, 512x512)
// on the fly — same "TS" monogram / brand color as the browser favicon
// (src/app/icon.tsx), just at the sizes manifest.ts references. A plain
// route handler (rather than Next's icon.tsx convention) so we can serve
// more than one fixed size from one file, picked by the `size` query param.
export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get("size"));
  const size = requested === 512 ? 512 : 192;

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
          fontSize: Math.round(size * 0.42),
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        TS
      </div>
    ),
    { width: size, height: size }
  );
}
