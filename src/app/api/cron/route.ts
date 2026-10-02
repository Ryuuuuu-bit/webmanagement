import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { runScheduledJobs } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional external trigger for the scheduled jobs (the in-process ticker
 * already runs them every 5 minutes). Requires CRON_SECRET, sent as
 * "Authorization: Bearer <secret>"; without the env var the route doesn't exist.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new NextResponse("Not found", { status: 404 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new NextResponse("Unauthorized", { status: 401 });
  // Safe alongside the in-process ticker: every send is claimed first.
  const result = await runScheduledJobs();
  return NextResponse.json({ ok: true, result });
}
