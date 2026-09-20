import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import UserManagement from "@/components/UserManagement";
import UserImport from "@/components/UserImport";
import { createUser, resetUserPassword, updateUserRole, updateUserSite, deleteUser, setUserActive, updateUsername, updateUserProfile, importUsers } from "@/actions/users";
import { adminClearWebauthnCredentials } from "@/actions/webauthn";
import { createEnrollmentLink } from "@/actions/enrollment";
import { sendPasswordSetupEmail } from "@/actions/passwordReset";
import { isEmailConfigured } from "@/lib/email";

export default async function AdminUsersPage() {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [users, departments, campusLocations] = await Promise.all([
    prisma.user.findMany({ include: { department: true, campusLocation: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.campusLocation.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
    <UserImport importUsers={importUsers} />
    <UserManagement
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        department: u.department ? { id: u.department.id, name: u.department.name } : null,
        campusLocation: u.campusLocation ? { id: u.campusLocation.id, name: u.campusLocation.name } : null,
        mustChangePassword: u.mustChangePassword,
        tempPasswordExpiresAt: u.tempPasswordExpiresAt?.toISOString() ?? null,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        consentAt: u.consentAt?.toISOString() ?? null,
      }))}
      departments={departments}
      campusLocations={campusLocations}
      currentUserId={session.user.id}
      createUser={createUser}
      resetUserPassword={resetUserPassword}
      updateUserRole={updateUserRole}
      updateUserSite={updateUserSite}
      deleteUser={deleteUser}
      clearWebauthnCredentials={adminClearWebauthnCredentials}
      setUserActive={setUserActive}
      createEnrollmentLink={createEnrollmentLink}
      updateUsername={updateUsername}
      sendPasswordSetupEmail={sendPasswordSetupEmail}
      updateUserProfile={updateUserProfile}
      emailConfigured={isEmailConfigured()}
    />
    </div>
  );
}
