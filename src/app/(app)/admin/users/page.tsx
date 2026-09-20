import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UserManagement from "@/components/UserManagement";
import { createUser, resetUserPassword, updateUserRole, updateUserSite, deleteUser } from "@/actions/users";
import { adminClearWebauthnCredentials } from "@/actions/webauthn";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const [users, departments, campusLocations] = await Promise.all([
    prisma.user.findMany({ include: { department: true, campusLocation: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.campusLocation.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <UserManagement
      users={users}
      departments={departments}
      campusLocations={campusLocations}
      currentUserId={session!.user.id}
      createUser={createUser}
      resetUserPassword={resetUserPassword}
      updateUserRole={updateUserRole}
      updateUserSite={updateUserSite}
      deleteUser={deleteUser}
      clearWebauthnCredentials={adminClearWebauthnCredentials}
    />
  );
}
