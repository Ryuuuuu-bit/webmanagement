import Link from "next/link";
import { prisma } from "@/lib/prisma";

async function verify(token: string | undefined) {
  if (!token) return { ok: false, message: "ไม่พบโทเคนยืนยันตัวตน" };

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) return { ok: false, message: "ลิงก์ยืนยันไม่ถูกต้องหรือถูกใช้ไปแล้ว" };

  if (record.expiresAt < new Date()) {
    await prisma.verificationToken.delete({ where: { id: record.id } });
    return { ok: false, message: "ลิงก์ยืนยันหมดอายุแล้ว กรุณาขอส่งอีเมลยืนยันใหม่จากหน้าเข้าสู่ระบบ" };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: new Date() } }),
    prisma.verificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  return { ok: true, message: "ยืนยันอีเมลสำเร็จแล้ว เข้าสู่ระบบได้เลย" };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const result = await verify(searchParams.token);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm">
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl ${result.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
          {result.ok ? "✓" : "!"}
        </div>
        <h1 className="mb-2 text-lg font-bold">{result.ok ? "ยืนยันอีเมลสำเร็จ" : "ยืนยันอีเมลไม่สำเร็จ"}</h1>
        <p className="mb-6 text-sm text-black/60">{result.message}</p>
        <Link href="/login" className="inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
