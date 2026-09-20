import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import NotificationProvider from "@/components/NotificationProvider";
import TempPasswordBanner from "@/components/TempPasswordBanner";
import { countUnread } from "@/lib/notify";
import { PDPA_VERSION } from "@/lib/consent";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // session.user is stripped when the JWT is stale (password/role changed
  // since it was issued) — treat that the same as no session at all.
  if (!session?.user?.id) redirect("/login");

  // Admin-created accounts start with a temporary password. Client decision:
  // don't block the app behind a forced change — let them in and nag with a
  // banner (plus a notification) until they set their own. The temporary
  // password itself still expires (tempPasswordExpiresAt, checked at login).
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true, tempPasswordExpiresAt: true, name: true, consentVersion: true },
  });
  // PDPA: the privacy notice (selfies + GPS) must be accepted once before
  // using the app, and again whenever its version changes.
  if (current && current.consentVersion !== PDPA_VERSION) redirect("/consent");

  const isAdmin = session.user.role === "ADMIN";
  // Seed the bell badge server-side so it's right on first paint; the
  // provider then keeps it current by polling.
  const initialUnread = await countUnread(session.user.id).catch(() => 0);

  return (
    <NotificationProvider initialUnread={initialUnread}>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar isAdmin={isAdmin} userName={current?.name ?? session.user.name ?? session.user.email ?? "-"} />
        <div className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          {current?.mustChangePassword && <TempPasswordBanner expiresAt={current.tempPasswordExpiresAt?.toISOString() ?? null} />}
          {children}
        </div>
      </div>
    </NotificationProvider>
  );
}
