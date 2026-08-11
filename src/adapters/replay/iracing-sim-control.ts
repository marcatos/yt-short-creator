import { spawn } from "node:child_process";

import type { Logger } from "@/src/ports/logger";

const SIM_STATUS_URL =
  "http://127.0.0.1:32034/get_sim_status?object=simStatus";

export type IracingSimControl = {
  openReplay(rpyPath: string): Promise<void>;
  waitUntilRunning(timeoutMs: number): Promise<void>;
  sleep(ms: number): Promise<void>;
};

export function createIracingSimControl(deps: {
  logger: Logger;
}): IracingSimControl {
  const log = deps.logger.child({ component: "IracingSimControl" });

  return {
    async openReplay(rpyPath) {
      const startedAt = performance.now();
      log.info("Opening iRacing replay", { rpyPath });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Start-Process -FilePath ${JSON.stringify(rpyPath)}`,
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) {
            log.info("Replay open requested", {
              rpyPath,
              durationMs: Math.round(performance.now() - startedAt),
            });
            resolve();
            return;
          }
          reject(
            new Error(
              `Failed to open replay ${rpyPath}: ${stderr.trim() || `exit ${code}`}`,
            ),
          );
        });
      });
    },

    async waitUntilRunning(timeoutMs) {
      const startedAt = performance.now();
      const deadline = Date.now() + timeoutMs;
      log.info("Waiting for iRacing sim", { timeoutMs });
      while (Date.now() < deadline) {
        try {
          const response = await fetch(SIM_STATUS_URL, {
            signal: AbortSignal.timeout(1_500),
          });
          const body = await response.text();
          if (body.includes("running:1")) {
            log.info("iRacing sim is running", {
              durationMs: Math.round(performance.now() - startedAt),
            });
            return;
          }
        } catch {
          // sim status endpoint unavailable until UI/sim is up
        }
        await this.sleep(1_000);
      }
      throw new Error(
        `iRacing did not report running within ${Math.round(timeoutMs / 1000)}s. Launch the sim / open the .rpy, enable video capture in Options, then retry.`,
      );
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}
