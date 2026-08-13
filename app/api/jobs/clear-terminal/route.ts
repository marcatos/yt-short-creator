import { NextResponse } from "next/server";

import { getContainer } from "@/src/lib/container";

export async function POST() {
  const container = getContainer();
  const logger = container.logger.child({
    route: "POST /api/jobs/clear-terminal",
  });
  const startedAt = performance.now();
  const cleared = container.jobQueue.clearTerminalJobs();
  logger.info("Terminal jobs cleared from queue", {
    cleared,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return NextResponse.json({ ok: true, cleared });
}
