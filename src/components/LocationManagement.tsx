"use client";

import { useRef, useState, useTransition } from "react";

type Loc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };
type ActionResult = { ok: boolean; message: string };

export default function LocationManagement({
  locations,
  createLocation,
  updateLocation,
  deleteLocation,
}: {
  locations: Loc[];
  createLocation: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateLocation: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteLocation: (id: string) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ id: string } & ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLocation(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateLocation(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`ลบจุดเช็คอิน "${name}" ใช่ไหม?`)) return;
    startTransition(() => deleteLocation(id));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">เพิ่มจุดเช็คอิน-เช็คเอาต์</h2>
        <p className="mt-1 text-sm text-black/50">
          พิกัดหาได้จาก Google Maps (คลิกขวาที่จุด แล้วคัดลอกตัวเลขละติจูด,ลองจิจูด) — อาจารย์ต้องอยู่ในรัศมีนี้ถึงจะเช็คอิน/เช็คเอาต์ได้
        </p>
        <form ref={formRef} onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <input name="name" required placeholder="ชื่อจุด เช่น คณะวิศวกรรมศาสตร์" className="input" />
            <input name="latitude" required type="number" step="any" placeholder="ละติจูด เช่น 13.8486" className="input" />
            <input name="longitude" required type="number" step="any" placeholder="ลองจิจูด เช่น 100.5681" className="input" />
            <input name="radiusMeters" required type="number" defaultValue={150} min={10} max={20000} placeholder="รัศมี (เมตร)" className="input" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "กำลังบันทึก..." : "เพิ่มจุดเช็คอิน"}
            </button>
            {createResult && (
              <span className={`text-sm ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">จุดเช็คอินทั้งหมด</h2>
        {locations.length === 0 && (
          <p className="mt-2 text-sm text-danger">ยังไม่มีจุดเช็คอินเลย — ตอนนี้ระบบจะยอม "ทุกตำแหน่ง" ให้เช็คอินได้ (ไม่มีการกันตำแหน่ง)</p>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {locations.map((loc) =>
            editingId === loc.id ? (
              <form key={loc.id} onSubmit={(e) => onEditSubmit(loc.id, e)} className="grid grid-cols-1 gap-3 rounded-lg border border-black/10 p-3 sm:grid-cols-2 md:grid-cols-5">
                <input name="name" required defaultValue={loc.name} className="input" />
                <input name="latitude" required type="number" step="any" defaultValue={loc.latitude} className="input" />
                <input name="longitude" required type="number" step="any" defaultValue={loc.longitude} className="input" />
                <input name="radiusMeters" required type="number" defaultValue={loc.radiusMeters} min={10} max={20000} className="input" />
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">บันทึก</button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-black/50">ยกเลิก</button>
                </div>
              </form>
            ) : (
              <div key={loc.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 text-sm first:border-t-0 first:pt-0">
                <div>
                  <span className="font-semibold">{loc.name}</span>
                  <span className="ml-2 text-black/40">
                    ({loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}) รัศมี {loc.radiusMeters} ม.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setEditingId(loc.id)} className="text-xs font-semibold text-brand-ink underline">แก้ไข</button>
                  <button disabled={pending} onClick={() => onDelete(loc.id, loc.name)} className="text-xs font-semibold text-danger disabled:opacity-40">ลบ</button>
                </div>
                {editResult?.id === loc.id && !editResult.ok && (
                  <p className="w-full text-xs text-danger">{editResult.message}</p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
