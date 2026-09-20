import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UserManagement from "@/components/UserManagement";
import { createUser, resetUserPassword, updateUserRole, updateUserSite, deleteUser, setUserActive } from "@/actions/users";
import { adminClearWebauthnCredentials } from "@/actions/webauthn";
import { createEnrollmentLink } from "@/actions/enrollment";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const [users, departments, campusLocations] = await Promise.all([
    prisma.user.findMany({ include: { department: true, campusLocation: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.campusLocation.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <UserManagement
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department ? { name: u.department.name } : null,
        campusLocation: u.campusLocation ? { id: u.campusLocation.id, name: u.campusLocation.name } : null,
        mustChangePassword: u.mustChangePassword,
        tempPasswordExpiresAt: u.tempPasswordExpiresAt?.toISOString() ?? null,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      }))}
      departments={departments}
      campusLocations={campusLocations}
      currentUserId={session!.user.id}
      createUser={createUser}
      resetUserPassword={resetUserPassword}
      updateUserRole={updateUserRole}
      updateUserSite={updateUserSite}
      deleteUser={deleteUser}
      clearWebauthnCredentials={adminClearWebauthnCredentials}
      setUserActive={setUserActive}
      createEnrollmentLink={createEnrollmentLink}
    />
  );
}
