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
    select: { mustChangePassword: true, passwordSetAt: true, email: true },
  });
  if (!user) redirect("/login");
  // No "current password" field when they never set one themselves: a
  // temporary password, or a QR-enrolled account that was never told it.
  const noCurrent = user.mustChangePassword || !user.passwordSetAt;
  return <ChangePasswordForm forced={noCurrent} enrolled={!user.mustChangePassword && !user.passwordSetAt} email={user.email} />;
}
