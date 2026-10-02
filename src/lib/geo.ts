import { prisma } from "@/lib/prisma";

import { haversineMeters } from "./haversine";

export { haversineMeters };

export type ExpectedSite = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };

/** A site plus its optional working-hours overrides (null = AppSetting defaults). */
export type SiteWithHours = ExpectedSite & { workStart: string | null; workEnd: string | null; lateGraceMinutes: number | null };

/**
 * Every site a teacher may check in/out at: the primary one
 * (User.campusLocationId) first, then any extra sites an Admin assigned
 * (UserSite) for teachers who move between sites during the day.
 */
export type AssignedSites = { primary: SiteWithHours | null; extras: SiteWithHours[]; all: SiteWithHours[] };

const SITE_SELECT = { id: true, name: true, latitude: true, longitude: true, radiusMeters: true, workStart: true, workEnd: true, lateGraceMinutes: true } as const;

export async function getAssignedSites(teacherId: string): Promise<AssignedSites> {
  const user = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { campusLocation: { select: SITE_SELECT }, extraSites: { select: { location: { select: SITE_SELECT } }, orderBy: { createdAt: "asc" } } },
  });
  const primary = user?.campusLocation ?? null;
  const extras = (user?.extraSites ?? []).map((x) => x.location).filter((l) => l.id !== primary?.id);
  return { primary, extras, all: primary ? [primary, ...extras] : extras };
}

/** Nearest site to the point, with its distance in meters (null when the list is empty). */
export function nearestSite<T extends ExpectedSite>(lat: number, lng: number, sites: T[]): { site: T; distance: number } | null {
  let best: { site: T; distance: number } | null = null;
  for (const site of sites) {
    const distance = haversineMeters(lat, lng, site.latitude, site.longitude);
    if (!best || distance < best.distance) best = { site, distance };
  }
  return best;
}

/** The nearest assigned site whose radius contains the point, or null. */
export function matchSite<T extends ExpectedSite>(lat: number, lng: number, sites: T[]): T | null {
  const inside = sites
    .map((site) => ({ site, distance: haversineMeters(lat, lng, site.latitude, site.longitude) }))
    .filter((x) => x.distance <= x.site.radiusMeters)
    .sort((a, b) => a.distance - b.distance);
  return inside[0]?.site ?? null;
}

export type ExpectedSiteResult =
  | { kind: "no_site" }
  | { kind: "ok"; site: ExpectedSite };

/**
 * Each teacher is permanently stationed at exactly one site (client concept:
 * the system now spans many organizations'/campuses' sites, with teachers
 * sent out to be "ประจำ" at one each) — so check-in/out is validated against
 * *that teacher's own assigned site* (User.campusLocationId), not derived
 * from the day's class schedule/room.
 *
 * This replaced an earlier version that resolved the expected site from the
 * teacher's schedule for the day (first class = check-in site, last class =
 * check-out site). That approach required every teacher to have complete,
 * up-to-date course/room data for each day, which doesn't fit a teacher who
 * is simply stationed at one site full-time — this direct assignment is
 * simpler, doesn't depend on schedule data entry, and matches how the client
 * actually organizes their (now multi-site) staff.
 *
 * No site assigned yet blocks check-in/out (rather than silently allowing
 * check-in from anywhere) — the caller decides the exact message.
 */
export async function getExpectedSite(teacherId: string): Promise<ExpectedSiteResult> {
  const user = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { campusLocation: true },
  });

  if (!user?.campusLocation) return { kind: "no_site" };
  return { kind: "ok", site: user.campusLocation };
}

export function isWithinSite(lat: number, lng: number, site: ExpectedSite) {
  return haversineMeters(lat, lng, site.latitude, site.longitude) <= site.radiusMeters;
}
