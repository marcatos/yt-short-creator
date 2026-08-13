/**
 * Job workers (FFmpeg, YouTube upload, long AV analysis) must not share the
 * Next.js Node process — that was freezing localhost under large media jobs.
 *
 * Default: Next only enqueues; run `npm run workers` in a second terminal.
 * Escape hatch: WORKERS_IN_NEXT=1 embeds workers again (not recommended).
 */
export function workersEmbeddedInNextEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.WORKERS_IN_NEXT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isDedicatedWorkerProcess(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.WORKER_PROCESS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
