/**
 * One-off: run Inspiration sync the same way workers do.
 * npx tsx scripts/studio-inspiration-sync-once.ts
 */
import { createLogger } from "../src/adapters/logging/pino-logger";
import { createYouTubeStudioInspirationAdapter } from "../src/adapters/youtube/studio-inspiration";

async function main(): Promise<void> {
  const log = createLogger("DEBUG").child({ component: "InspirationSyncOnce" });
  const adapter = createYouTubeStudioInspirationAdapter({ logger: log });
  const result = await adapter.sync();
  console.log(
    JSON.stringify(
      {
        status: result.status,
        ideaCount: result.ideas.length,
        titles: result.ideas.map((idea) => idea.title),
        summaries: result.ideas.map((idea) => idea.summary?.slice(0, 120)),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
