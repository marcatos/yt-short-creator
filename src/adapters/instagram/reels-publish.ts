import fs from "node:fs/promises";

import type { Logger } from "@/src/ports/logger";
import type {
  InstagramReelsPort,
  PublishReelInput,
  PublishReelResult,
} from "@/src/ports/instagram-reels";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const RUPLOAD_BASE = `https://rupload.facebook.com/ig-api-upload/${GRAPH_API_VERSION}`;

const POLL_INTERVAL_MS = 12_000;
const POLL_MAX_ATTEMPTS = 25;

type GraphErrorBody = {
  error?: { message?: string; code?: number };
};

type ContainerResponse = {
  id: string;
};

type StatusResponse = {
  status_code?: string;
};

type MediaResponse = {
  id?: string;
  permalink?: string;
};

async function parseGraphError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as GraphErrorBody;
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createMetaInstagramReelsAdapter(deps: {
  logger: Logger;
}): InstagramReelsPort {
  const log = deps.logger.child({ adapter: "instagramReels" });

  return {
    async publishReel(input: PublishReelInput): Promise<PublishReelResult> {
      const startedAt = performance.now();
      log.info("Instagram Reel publish started", {
        igUserId: input.igUserId,
        filePath: input.filePath,
        shareToFeed: input.shareToFeed,
      });

      const containerStartedAt = performance.now();
      const containerParams = new URLSearchParams({
        media_type: "REELS",
        upload_type: "resumable",
        caption: input.caption,
        share_to_feed: input.shareToFeed ? "true" : "false",
        access_token: input.accessToken,
      });
      const containerResponse = await fetch(
        `${GRAPH_BASE}/${input.igUserId}/media?${containerParams.toString()}`,
        { method: "POST" },
      );
      if (!containerResponse.ok) {
        throw new Error(
          `Instagram container creation failed: ${await parseGraphError(containerResponse)}`,
        );
      }
      const container = (await containerResponse.json()) as ContainerResponse;
      if (!container.id) {
        throw new Error("Instagram container creation did not return an id");
      }
      log.info("Instagram Reel container created", {
        containerId: container.id,
        durationMs: Math.round(performance.now() - containerStartedAt),
      });

      const uploadStartedAt = performance.now();
      const fileStat = await fs.stat(input.filePath);
      const fileBuffer = await fs.readFile(input.filePath);
      const uploadResponse = await fetch(`${RUPLOAD_BASE}/${container.id}`, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${input.accessToken}`,
          offset: "0",
          file_size: String(fileStat.size),
          "Content-Type": "application/octet-stream",
        },
        body: fileBuffer,
      });
      if (!uploadResponse.ok) {
        throw new Error(
          `Instagram video upload failed: ${await parseGraphError(uploadResponse)}`,
        );
      }
      log.info("Instagram Reel video uploaded", {
        containerId: container.id,
        fileSizeBytes: fileStat.size,
        durationMs: Math.round(performance.now() - uploadStartedAt),
      });

      const pollStartedAt = performance.now();
      let status = "IN_PROGRESS";
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        const statusParams = new URLSearchParams({
          fields: "status_code",
          access_token: input.accessToken,
        });
        const statusResponse = await fetch(
          `${GRAPH_BASE}/${container.id}?${statusParams.toString()}`,
        );
        if (!statusResponse.ok) {
          throw new Error(
            `Instagram container status failed: ${await parseGraphError(statusResponse)}`,
          );
        }
        const statusBody = (await statusResponse.json()) as StatusResponse;
        status = statusBody.status_code ?? "UNKNOWN";
        if (status === "FINISHED") break;
        if (status === "ERROR") {
          throw new Error("Instagram video processing failed (status ERROR)");
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (status !== "FINISHED") {
        throw new Error(
          `Instagram video processing timed out (last status: ${status})`,
        );
      }
      log.info("Instagram Reel processing finished", {
        containerId: container.id,
        durationMs: Math.round(performance.now() - pollStartedAt),
      });

      const publishStartedAt = performance.now();
      const publishParams = new URLSearchParams({
        creation_id: container.id,
        access_token: input.accessToken,
      });
      const publishResponse = await fetch(
        `${GRAPH_BASE}/${input.igUserId}/media_publish?${publishParams.toString()}`,
        { method: "POST" },
      );
      if (!publishResponse.ok) {
        throw new Error(
          `Instagram media_publish failed: ${await parseGraphError(publishResponse)}`,
        );
      }
      const published = (await publishResponse.json()) as MediaResponse;
      if (!published.id) {
        throw new Error("Instagram media_publish did not return a media id");
      }

      let permalink: string | null = null;
      try {
        const permalinkParams = new URLSearchParams({
          fields: "permalink",
          access_token: input.accessToken,
        });
        const permalinkResponse = await fetch(
          `${GRAPH_BASE}/${published.id}?${permalinkParams.toString()}`,
        );
        if (permalinkResponse.ok) {
          const permalinkBody = (await permalinkResponse.json()) as MediaResponse;
          permalink = permalinkBody.permalink ?? null;
        }
      } catch (error) {
        log.warn("Instagram permalink fetch failed", {
          mediaId: published.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      log.info("Instagram Reel publish completed", {
        mediaId: published.id,
        permalink,
        durationMs: Math.round(performance.now() - publishStartedAt),
        totalDurationMs: Math.round(performance.now() - startedAt),
      });

      return { mediaId: published.id, permalink };
    },
  };
}
