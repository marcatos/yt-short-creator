import { createInProcessJobQueue } from "@/src/adapters/jobs/in-process-queue";
import { createLogger } from "@/src/adapters/logging/pino-logger";
import { SystemClock } from "@/src/adapters/system/clock";
import { UuidIdPort } from "@/src/adapters/system/id";
import { createStubHandlers } from "@/src/workers/handlers";
import { createWorkerRunner } from "@/src/workers/runner";

let workersStarted = false;

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  const logger = createLogger();
  const clock = new SystemClock();
  const queue = createInProcessJobQueue({
    logger,
    idPort: new UuidIdPort(),
    clock,
  });
  const runner = createWorkerRunner({
    queue,
    handlers: createStubHandlers(),
    logger,
    clock,
  });

  runner.start();
  logger.info("Workers started");
}
