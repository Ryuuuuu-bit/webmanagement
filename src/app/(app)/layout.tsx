import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Admin-created accounts start with a temporary password — force a change
  // before letting the user reach any page in the app.
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });
  if (current?.mustChangePassword) redirect("/change-password");

  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</div>
    </div>
  );
}
