import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

/**
 * Session guard for pages under (app). The layout already redirects when
 * there's no valid session, but in the App Router a page renders in
 * parallel with its layout, so a page that dereferences `session!.user`
 * still crashes ("Cannot read properties of undefined (reading 'role')")
 * for a browser holding a stale JWT — e.g. right after the account was
 * deleted, suspended or signed out everywhere. Every page calls this
 * instead and gets a guaranteed user or a redirect.
 */
export async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  return session;
}
