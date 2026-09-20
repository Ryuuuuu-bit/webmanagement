import { redirect } from "next/navigation";

/**
 * Self-service password reset was removed (client decision: Admin resets
 * passwords). Old bookmarks and the link in earlier manuals land here, so
 * send them to the login page, which says to contact the administrator.
 */
export default function ForgotPasswordPage() {
  redirect("/login");
}
