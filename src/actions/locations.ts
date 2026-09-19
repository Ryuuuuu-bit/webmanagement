"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Dictionary } from "@/lib/i18n/dictionaries";

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
