// Sends account-verification emails via Brevo's transactional email HTTP API
// (https://api.brevo.com) instead of raw Gmail SMTP.
//
// Why: Railway (like most PaaS hosts) blocks outbound SMTP ports (587/465)
// to prevent spam abuse, so a direct Gmail SMTP connection just hangs until
// it times out. Brevo's API runs over plain HTTPS (port 443), which is
// never blocked, and its free tier (300 emails/day) needs only a single
// verified "sender" email — no custom domain required.
//
// Setup (see .env.example for the full walkthrough):
//   1. Create a free account at https://www.brevo.com
//   2. Verify your sender email under Senders, Domains & Dedicated IPs > Senders
//   3. Create an API key under SMTP & API > API Keys
//   4. Set BREVO_API_KEY and EMAIL_FROM (must match the verified sender) in the environment

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error(
      "BREVO_API_KEY / EMAIL_FROM ยังไม่ได้ตั้งค่า — ไม่สามารถส่งอีเมลยืนยันตัวตนได้"
    );
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "TeachSchedule", email: from },
      to: [{ email: to, name }],
      subject: "ยืนยันอีเมลเพื่อเปิดใช้งานบัญชี TeachSchedule",
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>สวัสดีคุณ ${name}</h2>
          <p>กรุณากดยืนยันอีเมลนี้เพื่อเปิดใช้งานบัญชีของคุณในระบบ TeachSchedule</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
              ยืนยันอีเมลของฉัน
            </a>
          </p>
          <p style="color:#666;font-size:13px;">ลิงก์นี้หมดอายุใน 24 ชั่วโมง หากไม่ได้เป็นผู้สมัครเอง สามารถละเว้นอีเมลนี้ได้</p>
          <p style="color:#999;font-size:12px;word-break:break-all;">${verifyUrl}</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo API error (${res.status}): ${body}`);
  }
}
