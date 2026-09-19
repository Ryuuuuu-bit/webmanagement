import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UserManagement from "@/components/UserManagement";
import { createUser, resetUserPassword, updateUserRole, deleteUser } from "@/actions/users";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const [users, departments] = await Promise.all([
    prisma.user.findMany({ include: { department: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <UserManagement
      users={users}
      departments={departments}
      currentUserId={session!.user.id}
      createUser={createUser}
      resetUserPassword={resetUserPassword}
      updateUserRole={updateUserRole}
      deleteUser={deleteUser}
    />
  );
}
