import { prisma } from "@/lib/prisma";
import { toWeekdayIndex } from "@/lib/date";

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

export type ExpectedSite = {
  campusLocation: { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };
  room: { id: string; name: string; building: string };
  course: { code: string; name: string };
};

export type ExpectedSiteResult =
  | { kind: "no_schedule" }
  | { kind: "no_location"; room: { name: string; building: string } }
  | { kind: "ok"; site: ExpectedSite };

/**
 * Each teacher can teach at a different site depending on the day, so
 * check-in/out is validated against *that teacher's own schedule for
 * today*, not "any registered campus location" (the old, looser check).
 *
 * A teacher can have multiple classes at different rooms/sites on the same
 * day (e.g. morning at one campus, afternoon at another) — since Attendance
 * is still a single row per user per day (one check-in, one check-out), we
 * resolve to the day's *first* class (earliest startTime) for check-in and
 * the day's *last* class (latest endTime) for check-out. That matches how a
 * teacher actually moves through their day: arrive at the first site,
 * leave from the last one.
 *
 * No schedule at all today, or a schedule whose room has no site assigned
 * yet in Master Data, both block check-in/out (rather than silently
 * falling back to "anywhere") — the caller decides the exact message.
 */
export async function getExpectedSite(
  teacherId: string,
  when: "checkin" | "checkout"
): Promise<ExpectedSiteResult> {
  const dayOfWeek = toWeekdayIndex(new Date());

  const schedules = await prisma.schedule.findMany({
    where: { teacherId, dayOfWeek },
    include: { room: { include: { campusLocation: true } }, course: true },
    orderBy: when === "checkin" ? { startTime: "asc" } : { endTime: "desc" },
    take: 1,
  });

  const target = schedules[0];
  if (!target) return { kind: "no_schedule" };

  const { room, course } = target;
  if (!room.campusLocation) {
    return { kind: "no_location", room: { name: room.name, building: room.building } };
  }

  return {
    kind: "ok",
    site: {
      campusLocation: room.campusLocation,
      room: { id: room.id, name: room.name, building: room.building },
      course: { code: course.code, name: course.name },
    },
  };
}

export function isWithinSite(lat: number, lng: number, site: ExpectedSite["campusLocation"]) {
  return haversineMeters(lat, lng, site.latitude, site.longitude) <= site.radiusMeters;
}
