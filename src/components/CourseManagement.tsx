"use client";

import { useRef, useState, useTransition } from "react";

type CourseRow = { id: string; code: string; name: string };
type ActionResult = { ok: boolean; message: string };

export default function CourseManagement({
  courses,
  createCourse,
  updateCourse,
  deleteCourse,
}: {
  courses: CourseRow[];
  createCourse: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateCourse: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteCourse: (id: string) => Promise<ActionResult>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ id: string } & ActionResult | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ id: string } & ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createCourse(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCourse(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, label: string) {
    if (!confirm(`ลบวิชา "${label}" ใช่ไหม?`)) return;
    startTransition(async () => {
      const res = await deleteCourse(id);
      setDeleteResult({ id, ...res });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">รายวิชา</h2>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        <input name="code" required placeholder="รหัสวิชา เช่น CS201" className="input w-36" />
        <input name="name" required placeholder="ชื่อวิชา" className="input" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? "กำลังบันทึก..." : "เพิ่ม"}
        </button>
        {createResult && <span className={`text-xs ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>}
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {courses.map((c) =>
          editingId === c.id ? (
            <form key={c.id} onSubmit={(e) => onEditSubmit(c.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <input name="code" required defaultValue={c.code} className="input w-36" />
              <input name="name" required defaultValue={c.name} className="input" />
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">บันทึก</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">ยกเลิก</button>
            </form>
          ) : (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span><span className="font-mono font-semibold">{c.code}</span> <span className="ml-1">{c.name}</span></span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold text-brand-ink underline">แก้ไข</button>
                <button disabled={pending} onClick={() => onDelete(c.id, `${c.code} ${c.name}`)} className="text-xs font-semibold text-danger disabled:opacity-40">ลบ</button>
              </div>
              {editResult?.id === c.id && !editResult.ok && <p className="w-full text-xs text-danger">{editResult.message}</p>}
              {deleteResult?.id === c.id && !deleteResult.ok && <p className="w-full text-xs text-danger">{deleteResult.message}</p>}
            </div>
          )
        )}
        {courses.length === 0 && <p className="text-sm text-faint">ยังไม่มีรายวิชา</p>}
      </div>
    </div>
  );
}
