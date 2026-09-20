/**
 * Outbound email via Resend's REST API (https://resend.com) — the only
 * emails this app sends are account-recovery links, so a single fetch()
 * call is all that's needed; no SDK dependency.
 *
 * Configuration (Railway service variables):
 *   RESEND_API_KEY  — required for sending; when unset, isEmailConfigured()
 *                     is false and callers tell the person to contact Admin
 *                     instead of pretending an email went out.
 *   EMAIL_FROM      — sender, e.g. "TeachSchedule <no-reply@your-domain.ac.th>".
 *                     Must be on a domain verified in Resend. Defaults to
 *                     Resend's onboarding sender, which can ONLY deliver to
 *                     the address that owns the Resend account (fine for a
 *                     first test, useless in production).
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "TeachSchedule <onboarding@resend.dev>";

export function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "send_failed" };

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      console.error("[email] resend responded", res.status, await res.text().catch(() => ""));
      return { ok: false, reason: "send_failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: "send_failed" };
  }
}

/** Minimal, client-safe HTML wrapper so the recovery email looks like the app (brand green button on a white card). */
export function renderEmail(opts: { title: string; greeting: string; body: string; buttonLabel: string; url: string; footer: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,'Sarabun',sans-serif;color:#1b231f">
  <div style="max-width:480px;margin:32px auto;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:16px;padding:32px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
      <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;background:#2f6f5e;color:#fff;font-weight:700;font-size:13px">TS</span>
      <span style="font-weight:700;font-size:15px">TeachSchedule</span>
    </div>
    <h1 style="font-size:18px;margin:0 0 8px">${esc(opts.title)}</h1>
    <p style="font-size:14px;color:rgba(0,0,0,.6);margin:0 0 16px">${esc(opts.greeting)}</p>
    <p style="font-size:14px;margin:0 0 20px">${esc(opts.body)}</p>
    <a href="${esc(opts.url)}" style="display:inline-block;background:#2f6f5e;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${esc(opts.buttonLabel)}</a>
    <p style="font-size:12px;color:rgba(0,0,0,.5);margin:20px 0 0;word-break:break-all">${esc(opts.url)}</p>
    <p style="font-size:12px;color:rgba(0,0,0,.4);margin:16px 0 0">${esc(opts.footer)}</p>
  </div></body></html>`;
  const text = `${opts.title}\n\n${opts.greeting}\n${opts.body}\n\n${opts.buttonLabel}: ${opts.url}\n\n${opts.footer}`;
  return { html, text };
}
