import { describe, expect, it, vi } from "vitest";

import { createEnqueueInstagramReel } from "@/src/application/enqueue-instagram-reel";
import type { Logger } from "@/src/ports/logger";

const now = new Date("2026-08-19T10:00:00.000Z");

function logger(): Logger {
  const instance: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => instance,
  };
  return instance;
}

describe("enqueueInstagramReel", () => {
  it("returns null when Instagram is not connected", async () => {
    const enqueue = vi.fn();
    const enqueueReel = createEnqueueInstagramReel({
      logger: logger(),
      queue: {
        enqueue,
        listJobs: () => [],
        getProgress: async () => null,
      },
      instagramAuth: {
        async getStoredTokens() {
          return null;
        },
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshLongLivedToken() {
          throw new Error("unused");
        },
        async saveTokens() {},
        async clearTokens() {},
        isConfigured: () => true,
      },
    });

    await expect(enqueueReel("candidate-1")).resolves.toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues publish_reel when connected and no active job exists", async () => {
    const enqueue = vi.fn(async () => "job-reel-1");
    const enqueueReel = createEnqueueInstagramReel({
      logger: logger(),
      queue: {
        enqueue,
        listJobs: () => [],
        getProgress: async () => null,
      },
      instagramAuth: {
        async getStoredTokens() {
          return {
            accessToken: "token",
            expiresAt: new Date(now.getTime() + 86_400_000),
            pageAccessToken: "page-token",
            pageId: "page-1",
            pageName: "Page",
            igUserId: "ig-1",
          };
        },
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshLongLivedToken() {
          throw new Error("unused");
        },
        async saveTokens() {},
        async clearTokens() {},
        isConfigured: () => true,
      },
    });

    await expect(enqueueReel("candidate-1")).resolves.toBe("job-reel-1");
    expect(enqueue).toHaveBeenCalledWith({
      type: "publish_reel",
      payload: { candidateId: "candidate-1" },
    });
  });

  it("skips enqueue when publish_reel is already active for the candidate", async () => {
    const enqueue = vi.fn();
    const enqueueReel = createEnqueueInstagramReel({
      logger: logger(),
      queue: {
        enqueue,
        listJobs: () => [
          {
            id: "job-existing",
            type: "publish_reel",
            payload: { candidateId: "candidate-1" },
            status: "queued",
            progressPct: 0,
            progressMessage: "",
            createdAt: now,
            updatedAt: now,
          },
        ],
        getProgress: async () => null,
      },
      instagramAuth: {
        async getStoredTokens() {
          return {
            accessToken: "token",
            expiresAt: new Date(now.getTime() + 86_400_000),
            pageAccessToken: "page-token",
            pageId: "page-1",
            pageName: "Page",
            igUserId: "ig-1",
          };
        },
        async getAuthorizationUrl() {
          return "";
        },
        async exchangeCode() {
          throw new Error("unused");
        },
        async refreshLongLivedToken() {
          throw new Error("unused");
        },
        async saveTokens() {},
        async clearTokens() {},
        isConfigured: () => true,
      },
    });

    await expect(enqueueReel("candidate-1")).resolves.toBe("job-existing");
    expect(enqueue).not.toHaveBeenCalled();
  });
});
