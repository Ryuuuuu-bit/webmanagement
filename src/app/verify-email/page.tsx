import { redirect } from "next/navigation";

// Email verification has been removed — this is a closed system where an
// admin creates accounts directly (see /admin/users). This route is kept
// only as a harmless redirect for any old bookmarked/emailed links.
export default function VerifyEmailPage() {
  redirect("/login");
}
