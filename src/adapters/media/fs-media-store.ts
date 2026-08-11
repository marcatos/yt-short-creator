import fs from "node:fs/promises";
import path from "node:path";

import type { MediaStorePort } from "@/src/ports/media-store";

const SUBDIRS = ["sources", "renders", "audio", "broll"] as const;

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

    audioPath(candidateId: string): string {
      return path.join(mediaRoot, "audio", `${candidateId}.mp3`);
    },

    brollPath(filename: string): string {
      return path.join(mediaRoot, "broll", path.basename(filename));
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
