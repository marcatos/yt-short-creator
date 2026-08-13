import fs from "node:fs/promises";
import path from "node:path";

import type { ShortCandidate } from "@/src/domain/entities";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import {
  createYoutubeMetadataDocument,
  type DeliveryAssetBundle,
} from "@/src/domain/youtube-metadata";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";

/**
 * Case A Short: one language-neutral master + dual audio/subs/metadata.
 * Case B (requiresLocalizedRender): caller supplies distinct IT/EN renders.
 */
export type PackageShortDeliveryAssets = (input: {
  candidate: ShortCandidate;
  masterVideoPath: string;
  voiceOvers: VoiceOverPackage[];
  requiresLocalizedRender: boolean;
  shortItPath?: string | null;
  shortEnPath?: string | null;
}) => Promise<DeliveryAssetBundle>;

export function createPackageShortDeliveryAssets(deps: {
  mediaStore: MediaStorePort;
  logger: Logger;
}): PackageShortDeliveryAssets {
  const log = deps.logger.child({ operation: "packageShortDeliveryAssets" });

  return async (input) => {
    const startedAt = performance.now();
    const candidateId = input.candidate.id;
    const writeText = deps.mediaStore.writeText?.bind(deps.mediaStore);
    if (!writeText) {
      throw new Error("Media store cannot write delivery metadata");
    }

    const deliveryDir = path.join(
      path.dirname(deps.mediaStore.renderPath(candidateId)),
      candidateId,
      "delivery",
    );
    await fs.mkdir(deliveryDir, { recursive: true });

    const byLang = new Map(
      input.voiceOvers.map((voiceOver) => [voiceOver.language, voiceOver]),
    );
    const it = byLang.get("it");
    const en = byLang.get("en");
    if (!it || !en) {
      throw new Error("IT and EN voice-overs required for Short packaging");
    }

    const masterPath = path.join(deliveryDir, "short_master.mp4");
    if (!input.requiresLocalizedRender) {
      await fs.copyFile(input.masterVideoPath, masterPath);
    }

    const metadataPath = path.join(deliveryDir, "youtube_metadata.json");
    const manualStudioChecklist = input.requiresLocalizedRender
      ? [
          "Case B: publish short_it.mp4 and short_en.mp4 as separate uploads (burned-in language).",
        ]
      : [
          "Attach secondary audio track in YouTube Studio when multi-audio API is unavailable.",
        ];

    const metadata = createYoutubeMetadataDocument({
      originalLanguage: "it",
      contentKind: "short",
      masterVideo: input.requiresLocalizedRender ? null : masterPath,
      requiresLocalizedRender: input.requiresLocalizedRender,
      it: {
        title: it.title,
        description: it.description,
        audio: it.audioPath,
        subtitles: it.srtPath,
        thumbnail: null,
      },
      en: {
        title: en.title,
        description: en.description,
        audio: en.audioPath,
        subtitles: en.srtPath,
        thumbnail: null,
      },
      manualStudioChecklist,
    });
    await writeText(metadataPath, JSON.stringify(metadata, null, 2));

    if (input.requiresLocalizedRender) {
      if (input.shortItPath) {
        await fs.copyFile(
          input.shortItPath,
          path.join(deliveryDir, "short_it.mp4"),
        );
      }
      if (input.shortEnPath) {
        await fs.copyFile(
          input.shortEnPath,
          path.join(deliveryDir, "short_en.mp4"),
        );
      }
    }

    const bundle: DeliveryAssetBundle = {
      sessionId: candidateId,
      raceAnalysisPath: "",
      youtubeMetadataPath: metadataPath,
      masterVideoPath: input.requiresLocalizedRender ? null : masterPath,
      audioItPath: it.audioPath,
      audioEnPath: en.audioPath,
      subtitlesItPath: it.srtPath,
      subtitlesEnPath: en.srtPath,
      thumbnailItPath: null,
      thumbnailEnPath: null,
      thumbnailConcept: null,
      metadata,
    };

    log.info("Short delivery assets packaged", {
      candidateId,
      requiresLocalizedRender: input.requiresLocalizedRender,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return bundle;
  };
}
