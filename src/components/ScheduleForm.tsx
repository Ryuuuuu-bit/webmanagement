"use client";

import { useRef, useState, useTransition } from "react";
import { DAY_LABELS, PERIOD_LABELS } from "@/lib/date";

type Option = { id: string; name?: string; code?: string; building?: string };

export default function ScheduleForm({
  action,
  teachers,
  courses,
  rooms,
  semesters,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
  teachers: Option[];
  courses: Option[];
  rooms: Option[];
  semesters: Option[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await action(formData);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <select name="teacherId" required className="input" defaultValue="">
          <option value="" disabled>อาจารย์</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select name="courseId" required className="input" defaultValue="">
          <option value="" disabled>วิชา</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
        </select>
        <select name="roomId" required className="input" defaultValue="">
          <option value="" disabled>ห้อง</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select name="semesterId" required className="input" defaultValue="">
          <option value="" disabled>ภาคเรียน</option>
          {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="dayOfWeek" required className="input" defaultValue="">
          <option value="" disabled>วัน</option>
          {DAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <select name="periodIndex" required className="input" defaultValue="">
          <option value="" disabled>คาบเวลา</option>
          {PERIOD_LABELS.map((p, i) => <option key={p} value={i}>{p}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "กำลังบันทึก..." : "เพิ่มตารางสอน"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-brand-ink" : "text-danger"}`}>{message.text}</span>
        )}
      </div>
    </form>
  );
}
