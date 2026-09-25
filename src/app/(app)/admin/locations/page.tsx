import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import LocationsWorkspace from "@/components/LocationsWorkspace";
import { createLocation, updateLocation, deleteLocation, searchLocationCandidates } from "@/actions/locations";

// Map-centric workspace (LocationsWorkspace). The previous form-first UI is
// still in src/components/LocationManagement.tsx — swap the import back and
// drop the `_count` mapping below to revert.
export default async function AdminLocationsPage() {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const rows = await prisma.campusLocation.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { teachers: true, rooms: true } } },
  });
  const locations = rows.map(({ _count, ...loc }) => ({ ...loc, teachers: _count.teachers, rooms: _count.rooms }));

  return (
    <LocationsWorkspace
      locations={locations}
      createLocation={createLocation}
      updateLocation={updateLocation}
      deleteLocation={deleteLocation}
      searchLocationCandidates={searchLocationCandidates}
    />
  );
}
