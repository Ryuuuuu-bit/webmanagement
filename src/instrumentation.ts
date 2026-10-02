/**
 * Runs once when the Next.js server boots. Starts the background scheduler
 * (reminders, lesson-plan deadlines, retention purge — src/lib/scheduler.ts)
 * inside the web process: no extra service to run or pay for. Every job is
 * idempotent (ReminderLog keys), so restarts or a second replica are safe.
 * Set DISABLE_SCHEDULER=1 to turn it off (e.g. when an external cron calls
 * /api/cron instead).
 *
 * The import sits inside `if (NEXT_RUNTIME === "nodejs")` so webpack drops it
 * from the edge build entirely (Prisma can't be bundled for edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Not during `next build` (it loads this file while collecting page data).
    if (process.env.DISABLE_SCHEDULER !== "1" && process.env.NEXT_PHASE !== "phase-production-build") {
      const { startScheduler } = await import("./lib/scheduler");
      startScheduler();
    }
  }
}
