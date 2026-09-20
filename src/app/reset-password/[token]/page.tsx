import { previewPasswordReset } from "@/actions/passwordReset";
import ResetPasswordClient from "@/components/ResetPasswordClient";

// Public page reached from a "forgot password" / "set your password" email
// (src/actions/passwordReset.ts). Not behind the auth middleware — the
// person has no session, that's the point.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params }: { params: { token: string } }) {
  const preview = await previewPasswordReset(params.token);
  return <ResetPasswordClient token={params.token} preview={preview} />;
}
