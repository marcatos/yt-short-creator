import fs from "node:fs/promises";
import path from "node:path";

import type { MediaStorePort } from "@/src/ports/media-store";

const SUBDIRS = [
  "sources",
  "renders",
  "audio",
  "voice-overs",
  "broll",
  "replays",
] as const;

export function createFsMediaStore(deps: {
  mediaRoot: string;
}): MediaStorePort {
  const mediaRoot = path.resolve(deps.mediaRoot);

  return {
    sourcePath(youtubeVideoId: string): string {
      return path.join(mediaRoot, "sources", `${youtubeVideoId}.mp4`);
    },

    renderPath(candidateId: string): string {
      return path.join(mediaRoot, "renders", `${candidateId}.mp4`);
    },

    voRenderPath(candidateId: string, language: "it" | "en"): string {
      return path.join(
        mediaRoot,
        "renders",
        path.basename(candidateId),
        `vo-${language}.mp4`,
      );
    },

    voPublishCheckpointPath(
      candidateId: string,
      language: "it" | "en",
    ): string {
      return path.join(
        mediaRoot,
        "voice-overs",
        `vo-publish-${path.basename(candidateId)}-${language}.json`,
      );
    },

    audioPath(candidateId: string): string {
      return path.join(mediaRoot, "audio", `${candidateId}.mp3`);
    },

    voPath(candidateId: string, language: "it" | "en"): string {
      return path.join(
        mediaRoot,
        "voice-overs",
        path.basename(candidateId),
        `vo-${language}.mp3`,
      );
    },

    async readText(filePath: string): Promise<string | null> {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
    },

    async writeText(filePath: string, content: string): Promise<void> {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    },

    brollPath(filename: string): string {
      return path.join(mediaRoot, "broll", path.basename(filename));
    },

    replayAnalysisDir(sessionId: string): string {
      return path.join(mediaRoot, "replays", sessionId);
    },

    fullReplayEncodePath(sessionId: string): string {
      return path.join(mediaRoot, "replays", sessionId, "full-youtube.mp4");
    },

    fullReplayVoPath(sessionId: string, language: "it" | "en"): string {
      return path.join(
        mediaRoot,
        "replays",
        path.basename(sessionId),
        `vo-${language}.mp3`,
      );
    },

    fullReplayVoRenderPath(sessionId: string, language: "it" | "en"): string {
      return path.join(
        mediaRoot,
        "replays",
        path.basename(sessionId),
        `full-youtube-${language}.mp4`,
      );
    },

    async listBroll(): Promise<string[]> {
      const brollRoot = path.join(mediaRoot, "broll");
      await fs.mkdir(brollRoot, { recursive: true });
      const entries = await fs.readdir(brollRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    },

    async ensureDirs(): Promise<void> {
      await Promise.all(
        SUBDIRS.map((dir) =>
          fs.mkdir(path.join(mediaRoot, dir), { recursive: true }),
        ),
      );
    },
  };
}
