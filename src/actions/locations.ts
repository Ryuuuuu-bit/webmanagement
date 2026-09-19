"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { searchPlace, type PlaceCandidate } from "@/lib/geocode";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function parseLocationInput(formData: FormData) {
  const name = (formData.get("name") as string || "").trim();
  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));
  const radiusMeters = Number(formData.get("radiusMeters"));
  return { name, latitude, longitude, radiusMeters };
}

function validateLocationInput(
  { name, latitude, longitude, radiusMeters }: ReturnType<typeof parseLocationInput>,
  dict: Dictionary
) {
  if (!name) return dict.actions.locations.fillName;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return dict.actions.locations.invalidLatitude;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return dict.actions.locations.invalidLongitude;
  if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 20000) return dict.actions.locations.invalidRadius;
  return null;
}

/** FR-17: campus check-in/out geofence points are data, editable by Admin — no code deploy needed. */
export async function createLocation(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseLocationInput(formData);
  const error = validateLocationInput(input, dict);
  if (error) return { ok: false, message: error };

  await prisma.campusLocation.create({ data: input });
  revalidatePath("/admin/locations");
  return { ok: true, message: dict.actions.locations.created(input.name) };
}

export async function updateLocation(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseLocationInput(formData);
  const error = validateLocationInput(input, dict);
  if (error) return { ok: false, message: error };

  await prisma.campusLocation.update({ where: { id }, data: input });
  revalidatePath("/admin/locations");
  return { ok: true, message: dict.actions.locations.updated(input.name) };
}

export async function deleteLocation(id: string) {
  await requireAdmin();
  await prisma.campusLocation.delete({ where: { id } });
  revalidatePath("/admin/locations");
}

/**
 * Place-name search backing the "search instead of copy-pasting lat/lng from
 * Google Maps" flow in LocationManagement. Uses Geoapify's free Geocoding API
 * (see src/lib/geocode.ts) rather than Google Places, since this admin-only,
 * low-volume lookup doesn't need a paid Google Cloud billing account. (We
 * previously used OpenStreetMap's unauthenticated Nominatim endpoint directly,
 * but its shared public instance has no uptime guarantee and intermittently
 * rejected requests; Geoapify still serves OSM-derived data, with a real quota
 * tied to an API key instead.)
 */
export async function searchLocationCandidates(
  query: string
): Promise<{ ok: boolean; message?: string; results?: PlaceCandidate[] }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const q = (query || "").trim();
  if (q.length < 3) return { ok: false, message: dict.actions.locations.searchTooShort };

  try {
    const results = await searchPlace(q);
    return { ok: true, results };
  } catch (err) {
    // Logged (not just swallowed) so a future failure shows up in Railway's
    // deploy logs with the actual cause (missing API key, HTTP status, etc.)
    // instead of only the generic message the admin sees.
    console.error("searchLocationCandidates failed:", err);
    return { ok: false, message: dict.actions.locations.searchFailed };
  }
}
