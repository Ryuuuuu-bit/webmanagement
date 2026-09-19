import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LocationManagement from "@/components/LocationManagement";
import { createLocation, updateLocation, deleteLocation, searchLocationCandidates } from "@/actions/locations";

export default async function AdminLocationsPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const locations = await prisma.campusLocation.findMany({ orderBy: { name: "asc" } });

  return (
    <LocationManagement
      locations={locations}
      createLocation={createLocation}
      updateLocation={updateLocation}
      deleteLocation={deleteLocation}
      searchLocationCandidates={searchLocationCandidates}
    />
  );
}
