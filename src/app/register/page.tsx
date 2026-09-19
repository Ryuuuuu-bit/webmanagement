"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { registerUser } from "@/actions/register";

export default function RegisterPage() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await registerUser(null, formData);
      setResult(res);
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">TS</div>
          <div>
            <div className="text-base font-bold leading-tight">TeachSchedule</div>
            <div className="text-xs text-black/50">ระบบตารางสอนอาจารย์</div>
          </div>
        </div>

        <h1 className="mb-1 text-lg font-bold">สมัครสมาชิก</h1>
        <p className="mb-6 text-sm text-black/50">สมัครแล้วต้องยืนยันอีเมล (Gmail) ก่อนเข้าสู่ระบบ</p>

        {result?.ok ? (
          <div className="rounded-lg bg-ok-soft p-4 text-sm text-ok">
            {result.message}
            <div className="mt-3">
              <Link href="/login" className="font-semibold underline">
                กลับไปหน้าเข้าสู่ระบบ
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">ชื่อ-นามสกุล</label>
              <input name="name" required className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand" placeholder="อ.สมชาย ใจดี" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">อีเมล (Gmail)</label>
              <input name="email" type="email" required className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand" placeholder="you@gmail.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">รหัสผ่าน</label>
              <input name="password" type="password" required minLength={8} className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand" placeholder="อย่างน้อย 8 ตัวอักษร" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">ยืนยันรหัสผ่าน</label>
              <input name="confirm" type="password" required minLength={8} className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand" />
            </div>
            {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
            <button type="submit" disabled={pending} className="mt-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "กำลังสมัคร..." : "สมัครสมาชิก"}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-black/40">
          มีบัญชีอยู่แล้ว?{" "}
          <Link href="/login" className="font-semibold text-brand-ink underline">
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}
