import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import NotificationProvider from "@/components/NotificationProvider";
import { countUnread } from "@/lib/notify";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // session.user is stripped when the JWT is stale (password/role changed
  // since it was issued) — treat that the same as no session at all.
  if (!session?.user?.id) redirect("/login");

  // Admin-created accounts start with a temporary password — force a change
  // before letting the user reach any page in the app.
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true, name: true },
  });
  if (current?.mustChangePassword) redirect("/change-password");

  const isAdmin = session.user.role === "ADMIN";
  // Seed the bell badge server-side so it's right on first paint; the
  // provider then keeps it current by polling.
  const initialUnread = await countUnread(session.user.id).catch(() => 0);

  return (
    <NotificationProvider initialUnread={initialUnread}>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar isAdmin={isAdmin} userName={current?.name ?? session.user.name ?? session.user.email ?? "-"} />
        <div className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</div>
      </div>
    </NotificationProvider>
  );
}
