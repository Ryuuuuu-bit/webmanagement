import { headers } from "next/headers";

/**
 * Server-side view of "which device is this?" for the audit log: the
 * installation id the client mirrors into the ts_did cookie (src/lib/
 * deviceId.ts) plus a short, human-readable reading of the User-Agent
 * ("iPhone · Safari", "Android · Chrome", "Windows · Edge"). Only the first
 * 8 characters of the id are kept — enough to see that two rows came from
 * the same phone, without turning the log into a tracking database.
 */

type HeaderLike = { get(name: string): string | null | undefined } | Record<string, string | undefined>;

function readHeader(h: HeaderLike | undefined, name: string): string | null {
  if (!h) return null;
  if (typeof (h as { get?: unknown }).get === "function") return (h as { get(n: string): string | null | undefined }).get(name) ?? null;
  const rec = h as Record<string, string | undefined>;
  return rec[name] ?? rec[name.toLowerCase()] ?? null;
}

export function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "-";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "?";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung"
        : /Line\//.test(ua)
          ? "LINE"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /FxiOS|Firefox\//.test(ua)
              ? "Firefox"
              : /Safari\//.test(ua)
                ? "Safari"
                : "?";
  return `${os} · ${browser}`;
}

/** "a3f9c12b · iPhone · Safari" — or just the UA part when the cookie is missing (first ever request, cookies blocked). */
export function describeDevice(h?: HeaderLike): string {
  let hdr: HeaderLike | undefined = h;
  if (!hdr) {
    try {
      hdr = headers();
    } catch {
      return "-";
    }
  }
  const cookie = readHeader(hdr, "cookie") ?? "";
  const m = /(?:^|;\s*)ts_did=([A-Za-z0-9-]+)/.exec(cookie);
  const id = m ? m[1].slice(0, 8) : null;
  const ua = summarizeUserAgent(readHeader(hdr, "user-agent"));
  return id ? `${id} · ${ua}` : ua;
}
