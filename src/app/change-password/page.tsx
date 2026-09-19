"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { changeOwnPassword } from "@/actions/users";

export default function ChangePasswordPage() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await changeOwnPassword(null, formData);
      setResult(res);
      if (res.ok) {
        // Changing the password bumps the account's session version, so this
        // browser's own session is invalidated too — sign out cleanly and
        // send them to log back in with the new password.
        signOut({ callbackUrl: "/login" });
      }
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

        <h1 className="mb-1 text-lg font-bold">ตั้งรหัสผ่านใหม่</h1>
        <p className="mb-6 text-sm text-black/50">บัญชีนี้ใช้รหัสผ่านชั่วคราวอยู่ กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานระบบ</p>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">รหัสผ่านใหม่</label>
            <input
              name="newPassword"
              type="password"
              required
              minLength={8}
              className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="อย่างน้อย 8 ตัวอักษร"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">ยืนยันรหัสผ่านใหม่</label>
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "กำลังบันทึก..." : "ตั้งรหัสผ่านใหม่"}
          </button>
        </form>
      </div>
    </div>
  );
}
