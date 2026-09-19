type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

type GoogleTextSearchResponse = {
  places?: GooglePlace[];
};

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

export type PlaceCandidate = { label: string; lat: number; lng: number };

/**
 * Looks up a place by name via Google's Places API (New) — Text Search.
 *
 * We tried two OpenStreetMap-based providers before this (Nominatim, then
 * Geoapify): Geoapify fixed the *reliability* problem (Nominatim's shared
 * public server randomly rejecting requests), but both still draw from the
 * same underlying OpenStreetMap dataset, which has much sparser coverage of
 * Thai place names, businesses and informal names than Google's — that's a
 * data-coverage problem no OSM-based provider can fix. Google's own dataset
 * doesn't have that gap.
 *
 * Requires the GOOGLE_PLACES_API_KEY environment variable, from a Google
 * Cloud project with billing enabled and "Places API (New)" turned on. At
 * this admin-only, low-volume usage (searching only when adding a new
 * check-in location), usage should comfortably stay within Google's free
 * monthly quota for Text Search — but unlike the previous providers, this
 * one does require a billing account/card on file with Google.
 */
export async function searchPlace(query: string): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  }

  const res = await fetch(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "th",
      regionCode: "TH",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Google Places request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as GoogleTextSearchResponse;
  return (data.places ?? [])
    .filter((p) => p.location?.latitude != null && p.location?.longitude != null)
    .map((p) => ({
      label: p.displayName?.text || p.formattedAddress || query,
      lat: p.location!.latitude!,
      lng: p.location!.longitude!,
    }));
}
