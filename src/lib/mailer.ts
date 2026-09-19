import nodemailer from "nodemailer";

// Gmail SMTP transport for account verification emails (self-registration flow).
// Requires a Gmail account with 2-Step Verification on, and an "App Password"
// (https://myaccount.google.com/apppasswords) — a normal Gmail password will
// NOT work here. Set GMAIL_USER + GMAIL_APP_PASSWORD in the environment.
function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD ยังไม่ได้ตั้งค่า — ไม่สามารถส่งอีเมลยืนยันตัวตนได้"
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  const transport = getTransport();
  const from = process.env.EMAIL_FROM || process.env.GMAIL_USER;

  await transport.sendMail({
    from: `TeachSchedule <${from}>`,
    to,
    subject: "ยืนยันอีเมลเพื่อเปิดใช้งานบัญชี TeachSchedule",
    html: `
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
  });
}
