"use client";

import { useState, useTransition } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useLanguage } from "./LanguageProvider";

type ActionResult = { ok: boolean; message: string };

/**
 * "ลืมทั้งสองอย่าง" (forgot both check-in AND check-out) needs two separate
 * time fields, not one — a teacher who forgot both has two real, different
 * moments to attest to. This form shows one time field for a one-sided
 * request and two (check-in / check-out) when "forgot both" is selected.
 */
export default function AttestForm({
  requestAttestation,
}: {
  requestAttestation: (formData: FormData) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const [type, setType] = useState<keyof Dictionary["attest"]["types"]>("FORGOT_BOTH");
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
        <Field label={dict.attest.fieldDate}>
          <input type="date" name="date" required className="input" />
        </Field>
        <Field label={dict.attest.fieldType}>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as keyof Dictionary["attest"]["types"])}
            className="input"
          >
            <option value="FORGOT_CHECKIN">{dict.attest.types.FORGOT_CHECKIN}</option>
            <option value="FORGOT_CHECKOUT">{dict.attest.types.FORGOT_CHECKOUT}</option>
            <option value="FORGOT_BOTH">{dict.attest.types.FORGOT_BOTH}</option>
          </select>
        </Field>
        {type === "FORGOT_BOTH" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={dict.attest.fieldTimeCheckin}>
              <input type="time" name="time" required className="input" />
            </Field>
            <Field label={dict.attest.fieldTimeCheckout}>
              <input type="time" name="time2" required className="input" />
            </Field>
          </div>
        ) : (
          <Field label={type === "FORGOT_CHECKOUT" ? dict.attest.fieldTimeCheckout : dict.attest.fieldTimeCheckin}>
            <input type="time" name="time" required className="input" />
          </Field>
        )}
      </div>
      <Field label={dict.attest.fieldReason}>
        <textarea name="reason" required className="input min-h-[70px]" placeholder={dict.attest.reasonPlaceholder} />
      </Field>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? dict.attest.submitting : dict.attest.submit}
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
