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

/**
 * FR-4.2 / FR-17: check-in and check-out must happen while inside one of the
 * registered campus locations. Locations are data (CampusLocation), never
 * hardcoded, so Admin can add/adjust buildings without a code change.
 */
export async function isWithinAnyCampus(lat: number, lng: number) {
  const locations = await prisma.campusLocation.findMany();
  if (locations.length === 0) return true; // no geofence configured yet — don't block dev/testing
  return locations.some((loc) => haversineMeters(lat, lng, loc.latitude, loc.longitude) <= loc.radiusMeters);
}
