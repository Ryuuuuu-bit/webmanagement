import { redirect } from "next/navigation";

// Self-registration has been removed — this is a closed system where an
// admin creates accounts (see /admin/users). This route is kept only as a
// harmless redirect for any old bookmarked links.
export default function RegisterPage() {
  redirect("/login");
}
