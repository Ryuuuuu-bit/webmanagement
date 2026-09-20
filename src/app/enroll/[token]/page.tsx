import { previewEnrollment } from "@/actions/enrollment";
import EnrollClient from "@/components/EnrollClient";

// Public page a teacher lands on after scanning the enrollment QR their
// Admin generated (src/actions/enrollment.ts). Not behind the auth
// middleware on purpose — the whole point is they aren't signed in yet.
export const dynamic = "force-dynamic";

export default async function EnrollPage({ params }: { params: { token: string } }) {
  const preview = await previewEnrollment(params.token);
  return <EnrollClient token={params.token} preview={preview} />;
}
