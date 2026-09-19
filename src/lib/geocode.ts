type GeoapifyResult = {
  formatted: string;
  lat: number;
  lon: number;
};

type GeoapifyResponse = {
  results?: GeoapifyResult[];
};

const GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search";

export type PlaceCandidate = { label: string; lat: number; lng: number };

/**
 * Looks up a place by name via Geoapify's Geocoding API — free (3,000
 * lookups/day on the free plan, no credit card required), and far more
 * reliable than the public OpenStreetMap Nominatim instance we used before:
 * Nominatim is a volunteer-run server with no uptime guarantee and can
 * intermittently reject requests even when a caller follows its usage
 * policy. Geoapify still serves OpenStreetMap-derived data, but as a
 * commercial API with an actual quota tied to an API key instead of a
 * shared, unauthenticated public endpoint.
 *
 * Requires the GEOAPIFY_API_KEY environment variable (free key from
 * https://www.geoapify.com/). Deliberately NOT wired to fire on every
 * keystroke — callers should only invoke this on an explicit user action
 * (a search button / Enter key), to stay well within the free daily quota.
 */
export async function searchPlace(query: string): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    throw new Error("GEOAPIFY_API_KEY is not configured");
  }

  const url = new URL(GEOAPIFY_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("filter", "countrycode:th");
  url.searchParams.set("lang", "th");
  url.searchParams.set("limit", "5");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Geoapify request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as GeoapifyResponse;
  return (data.results ?? []).map((r) => ({
    label: r.formatted,
    lat: r.lat,
    lng: r.lon,
  }));
}
