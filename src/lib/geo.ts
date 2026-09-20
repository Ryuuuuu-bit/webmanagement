import { prisma } from "@/lib/prisma";

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type ExpectedSite = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };

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
