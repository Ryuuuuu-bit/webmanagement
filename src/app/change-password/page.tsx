import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ChangePasswordForm from "@/components/ChangePasswordForm";

// Server wrapper so the form knows whether this is the forced first-login
// change (temporary password — no current password to ask for) or a normal
// self-service change (current password required; extra security tools).
export default async function ChangePasswordPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true, email: true },
  });
  if (!user) redirect("/login");
  return <ChangePasswordForm forced={user.mustChangePassword} email={user.email} />;
}
