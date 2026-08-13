export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { workersEmbeddedInNextEnabled } = await import(
    "@/src/lib/worker-mode"
  );
  if (!workersEmbeddedInNextEnabled()) {
    // Default: UI enqueues only. Heavy jobs run via `npm run workers`.
    return;
  }

  const { startWorkers } = await import("@/src/lib/container");
  startWorkers();
}
