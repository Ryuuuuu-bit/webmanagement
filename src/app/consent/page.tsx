import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PDPA_VERSION } from "@/lib/consent";
import ConsentClient from "@/components/ConsentClient";

export const dynamic = "force-dynamic";

/** PDPA privacy notice — shown once after login (and again when PDPA_VERSION changes). */
export default async function ConsentPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { consentVersion: true } });
  if (user?.consentVersion === PDPA_VERSION) redirect("/dashboard");
  return <ConsentClient version={PDPA_VERSION} />;
}
