"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
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
  // Optional per-site working hours (blank = use the global defaults).
  const workStart = ((formData.get("workStart") as string) || "").trim() || null;
  const workEnd = ((formData.get("workEnd") as string) || "").trim() || null;
  const graceRaw = ((formData.get("lateGraceMinutes") as string) || "").trim();
  const lateGraceMinutes = graceRaw === "" ? null : Math.round(Number(graceRaw));
  return { name, latitude, longitude, radiusMeters, workStart, workEnd, lateGraceMinutes };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateLocationInput(
  { name, latitude, longitude, radiusMeters, workStart, workEnd, lateGraceMinutes }: ReturnType<typeof parseLocationInput>,
  dict: Dictionary
) {
  if (!name) return dict.actions.locations.fillName;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return dict.actions.locations.invalidLatitude;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return dict.actions.locations.invalidLongitude;
  if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 20000) return dict.actions.locations.invalidRadius;
  if ((workStart && !TIME_RE.test(workStart)) || (workEnd && !TIME_RE.test(workEnd)) || (workStart && workEnd && workEnd <= workStart)) {
    return dict.actions.policy.invalidHours;
  }
  if (lateGraceMinutes !== null && (!Number.isFinite(lateGraceMinutes) || lateGraceMinutes < 0 || lateGraceMinutes > 180)) {
    return dict.actions.policy.invalidGrace;
  }
  return null;
}

/** FR-17: campus check-in/out geofence points are data, editable by Admin — no code deploy needed. */
export async function createLocation(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseLocationInput(formData);
  const error = validateLocationInput(input, dict);
  if (error) return { ok: false, message: error };

  await prisma.campusLocation.create({ data: input });
  await logAudit({
    action: "LOCATION_CHANGED",
    actorId: session.user.id,
    ip: getClientIp(),
    detail: `created "${input.name}" (${input.latitude}, ${input.longitude}) radius=${input.radiusMeters}m`,
  });
  revalidatePath("/admin/locations");
  return { ok: true, message: dict.actions.locations.created(input.name) };
}

export async function updateLocation(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseLocationInput(formData);
  const error = validateLocationInput(input, dict);
  if (error) return { ok: false, message: error };

  await prisma.campusLocation.update({ where: { id }, data: input });
  // Geofence coordinates/radius are a fraud-relevant control (they decide
  // who can check in from where), so — like every other admin mutation in
  // this codebase — this needs an audit trail even though it's "just" master
  // data with no dedicated review UI of its own.
  await logAudit({
    action: "LOCATION_CHANGED",
    actorId: session.user.id,
    ip: getClientIp(),
    detail: `updated "${input.name}" (${input.latitude}, ${input.longitude}) radius=${input.radiusMeters}m`,
  });
  revalidatePath("/admin/locations");
  return { ok: true, message: dict.actions.locations.updated(input.name) };
}

/** Blocked if any teacher or room is still assigned — avoids silently orphaning their site. */
export async function deleteLocation(id: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const loc = await prisma.campusLocation.findUnique({
    where: { id },
    include: { _count: { select: { teachers: true, rooms: true } } },
  });
  if (!loc) return { ok: false, message: dict.actions.locations.notFound };
  const inUseCount = loc._count!.teachers + loc._count!.rooms;
  if (inUseCount > 0) {
    return { ok: false, message: dict.actions.locations.inUse(inUseCount) };
  }

  await prisma.campusLocation.delete({ where: { id } });
  await logAudit({ action: "LOCATION_CHANGED", actorId: session.user.id, ip: getClientIp(), detail: `deleted "${loc.name}"` });
  revalidatePath("/admin/locations");
  return { ok: true, message: dict.actions.locations.deleted(loc.name) };
}

/**
 * Place-name search backing the "search instead of copy-pasting lat/lng from
 * Google Maps" flow in LocationManagement. Uses Google's Places API (New)
 * (see src/lib/geocode.ts). We tried two free OpenStreetMap-based providers
 * first (Nominatim, then Geoapify) — Geoapify fixed Nominatim's reliability
 * problem, but both draw from the same OSM dataset, whose coverage of Thai
 * place names/businesses is noticeably thinner than Google's, so searches
 * kept coming back empty or inaccurate. Google's own data doesn't have that
 * gap; at this admin-only, low-volume usage it should stay within Google's
 * free monthly quota, though (unlike the OSM-based options) it does require
 * a Google Cloud billing account with a card on file.
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
