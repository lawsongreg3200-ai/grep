/**
 * Scheduled work.
 *
 * This is the concrete reason the watcher moves to Convex: today the email
 * watch only runs when somebody presses SYNC NOW on the dashboard
 * (`triggerSync` in src/lib/server.ts). On a schedule it runs whether or not a
 * browser is open — which is the difference between "a page" and "a watcher".
 *
 * Every 5 minutes is a deliberate starting point, not a promise: each pass is
 * cheap while it is a stub, and the interval should be revisited when the IMAP
 * fetch is ported in (IMAP connections are rate-limited by the provider).
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "robo deebo email watch pass",
  { minutes: 5 },
  internal.watch.runWatchPass,
  { source: "cron" as const },
);

export default crons;
