type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// caps the public instance at 1 request/second. This is a free service with no
// API key, so we throttle ourselves rather than risk getting blocked.
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

export type PlaceCandidate = { label: string; lat: number; lng: number };

/**
 * Looks up a place by name via OpenStreetMap's Nominatim search API — free,
 * no API key, no Google Cloud billing account needed.
 *
 * Deliberately NOT wired to fire on every keystroke: Nominatim's usage policy
 * explicitly forbids implementing live autocomplete against the public
 * instance ("this is not yet supported... you must not implement such a
 * service on the client side"). Callers must only invoke this on an explicit
 * user action (a search button / Enter key), never on each keystroke. This
 * function also self-throttles to <=1 request/second and sends a real
 * User-Agent identifying the app, per that same policy.
 */
export async function searchPlace(query: string): Promise<PlaceCandidate[]> {
  await throttle();

  const contact = process.env.NEXTAUTH_URL || "https://teachschedule.app";
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "th");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url, {
    headers: {
      "User-Agent": `TeachSchedule/1.0 (${contact})`,
      "Accept-Language": "th",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed: ${res.status}`);
  }

  const data = (await res.json()) as NominatimResult[];
  return data.map((d) => ({
    label: d.display_name,
    lat: Number(d.lat),
    lng: Number(d.lon),
  }));
}
