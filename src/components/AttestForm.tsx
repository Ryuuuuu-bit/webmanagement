"use client";

import { useState, useTransition } from "react";

type ActionResult = { ok: boolean; message: string };

const TYPE_LABEL: Record<string, string> = {
  FORGOT_CHECKIN: "ลืมเช็คอิน",
  FORGOT_CHECKOUT: "ลืมเช็คเอาต์",
  FORGOT_BOTH: "ลืมทั้งสองอย่าง",
};

/**
 * "ลืมทั้งสองอย่าง" (forgot both check-in AND check-out) needs two separate
 * time fields, not one — a teacher who forgot both has two real, different
 * moments to attest to. This form shows one time field for a one-sided
 * request and two (เช็คอิน / เช็คเอาต์) when "ลืมทั้งสองอย่าง" is selected.
 */
export default function AttestForm({
  requestAttestation,
}: {
  requestAttestation: (formData: FormData) => Promise<ActionResult>;
}) {
  const [type, setType] = useState<keyof typeof TYPE_LABEL>("FORGOT_BOTH");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const res = await requestAttestation(formData);
      if (res.ok) {
        setFormError(null);
        form.reset();
        setType("FORGOT_BOTH");
      } else {
        setFormError(res.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Field label="วันที่">
          <input type="date" name="date" required className="input" />
        </Field>
        <Field label="ประเภท">
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as keyof typeof TYPE_LABEL)}
            className="input"
          >
            <option value="FORGOT_CHECKIN">{TYPE_LABEL.FORGOT_CHECKIN}</option>
            <option value="FORGOT_CHECKOUT">{TYPE_LABEL.FORGOT_CHECKOUT}</option>
            <option value="FORGOT_BOTH">{TYPE_LABEL.FORGOT_BOTH}</option>
          </select>
        </Field>
        {type === "FORGOT_BOTH" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="เวลาเช็คอิน">
              <input type="time" name="time" required className="input" />
            </Field>
            <Field label="เวลาเช็คเอาต์">
              <input type="time" name="time2" required className="input" />
            </Field>
          </div>
        ) : (
          <Field label={type === "FORGOT_CHECKOUT" ? "เวลาเช็คเอาต์" : "เวลาเช็คอิน"}>
            <input type="time" name="time" required className="input" />
          </Field>
        )}
      </div>
      <Field label="เหตุผล">
        <textarea name="reason" required className="input min-h-[70px]" placeholder="เช่น มือถือแบตหมด, สัญญาณ GPS ขัดข้อง" />
      </Field>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "กำลังส่ง..." : "ส่งคำขอรับรองเวลา"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
