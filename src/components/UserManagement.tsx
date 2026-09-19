"use client";

import { useRef, useState, useTransition } from "react";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: { name: string } | null;
  mustChangePassword: boolean;
};
type Dept = { id: string; name: string };
type ActionResult = { ok: boolean; message: string; tempPassword?: string };

export default function UserManagement({
  users,
  departments,
  currentUserId,
  createUser,
  resetUserPassword,
  updateUserRole,
  deleteUser,
}: {
  users: UserRow[];
  departments: Dept[];
  currentUserId: string;
  createUser: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  resetUserPassword: (userId: string) => Promise<ActionResult>;
  updateUserRole: (userId: string, role: "ADMIN" | "MEMBER") => Promise<{ ok: boolean; message: string }>;
  deleteUser: (userId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [resetResult, setResetResult] = useState<{ userId: string } & ActionResult | null>(null);
  const [roleResult, setRoleResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setResetResult(null);
    startTransition(async () => {
      const res = await createUser(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onReset(userId: string, name: string) {
    if (!confirm(`รีเซ็ตรหัสผ่านของ ${name} ใช่ไหม? รหัสผ่านเดิมจะใช้ไม่ได้ทันที`)) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await resetUserPassword(userId);
      setResetResult({ userId, ...res });
    });
  }

  function onRoleChange(userId: string, name: string, role: "ADMIN" | "MEMBER") {
    if (!confirm(`เปลี่ยนบทบาทของ ${name} เป็น ${role} ใช่ไหม?`)) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await updateUserRole(userId, role);
      setRoleResult({ userId, ...res });
    });
  }

  function onDelete(userId: string, name: string) {
    if (!confirm(`ลบบัญชี "${name}" ใช่ไหม? จะลบตารางสอน/ประวัติเข้างาน/คำขอลาและรับรองเวลาของคนนี้ทั้งหมดด้วย และกู้คืนไม่ได้`)) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await deleteUser(userId);
      setDeleteResult({ userId, ...res });
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">เพิ่มผู้ใช้ใหม่</h2>
        <p className="mt-1 text-sm text-muted">
          ระบบจะสุ่มรหัสผ่านชั่วคราวให้ — แจ้งเจ้าตัวเอง (พูด/LINE) แล้วให้ตั้งรหัสผ่านใหม่ตอน login ครั้งแรก
        </p>
        <form ref={formRef} onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <input name="name" required placeholder="ชื่อ-นามสกุล" className="input" />
            <input name="email" type="email" required placeholder="อีเมล" className="input" />
            <select name="departmentId" className="input" defaultValue="">
              <option value="">ภาควิชา (ไม่ระบุ)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select name="role" className="input" defaultValue="MEMBER">
              <option value="MEMBER">อาจารย์ (Member)</option>
              <option value="ADMIN">ผู้ดูแลระบบ (Admin)</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "กำลังสร้าง..." : "สร้างบัญชี"}
            </button>
          </div>
        </form>

        {createResult && (
          <div className={`mt-4 rounded-lg p-4 text-sm ${createResult.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
            <p>{createResult.message}</p>
            {createResult.tempPassword && (
              <p className="mt-2 font-mono text-base font-bold tracking-wide">{createResult.tempPassword}</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">ผู้ใช้ทั้งหมด</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">ชื่อ</th>
                <th className="pb-2">อีเมล</th>
                <th className="pb-2">ภาควิชา</th>
                <th className="pb-2">บทบาท</th>
                <th className="pb-2">สถานะรหัสผ่าน</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line-soft align-top">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2 text-muted">{u.email}</td>
                  <td className="py-2">{u.department?.name ?? "—"}</td>
                  <td className="py-2">
                    {u.id === currentUserId ? (
                      <span className="badge bg-info-soft text-info">{u.role} (คุณ)</span>
                    ) : (
                      <select
                        disabled={pending}
                        value={u.role}
                        onChange={(e) => onRoleChange(u.id, u.name, e.target.value as "ADMIN" | "MEMBER")}
                        className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-40"
                      >
                        <option value="MEMBER">MEMBER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    )}
                    {roleResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${roleResult.ok ? "text-ok" : "text-danger"}`}>{roleResult.message}</div>
                    )}
                  </td>
                  <td className="py-2">
                    {u.mustChangePassword ? (
                      <span className="badge bg-warn-soft text-warn">รอผู้ใช้ตั้งรหัสผ่านใหม่</span>
                    ) : (
                      <span className="text-faint">ใช้งานปกติ</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        disabled={pending}
                        onClick={() => onReset(u.id, u.name)}
                        className="text-xs font-semibold text-brand-ink underline disabled:opacity-40"
                      >
                        รีเซ็ตรหัสผ่าน
                      </button>
                      {u.role !== "ADMIN" && u.id !== currentUserId && (
                        <button
                          disabled={pending}
                          onClick={() => onDelete(u.id, u.name)}
                          className="text-xs font-semibold text-danger underline disabled:opacity-40"
                        >
                          ลบบัญชี
                        </button>
                      )}
                    </div>
                    {resetResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${resetResult.ok ? "text-ok" : "text-danger"}`}>
                        {resetResult.message}
                        {resetResult.tempPassword && (
                          <div className="mt-1 font-mono text-sm font-bold tracking-wide text-ink">{resetResult.tempPassword}</div>
                        )}
                      </div>
                    )}
                    {deleteResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${deleteResult.ok ? "text-ok" : "text-danger"}`}>{deleteResult.message}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
