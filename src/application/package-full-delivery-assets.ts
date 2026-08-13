import fs from "node:fs/promises";
import path from "node:path";

import type { EditorialPackage } from "@/src/domain/editorial";
import type { RaceAnalysis } from "@/src/domain/race-analysis";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import {
  createYoutubeMetadataDocument,
  type DeliveryAssetBundle,
  type ThumbnailConcept,
} from "@/src/domain/youtube-metadata";
import type { ClockPort } from "@/src/ports/clock";
import type { FullVoMixPort } from "@/src/ports/full-vo-mix";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import { createSvgThumbnailRenderer } from "@/src/adapters/thumbnails/svg-thumbnail-renderer";

type Dependencies = {
  mediaStore: MediaStorePort;
  replaySessions: ReplaySessionRepository;
  fullVoMix: FullVoMixPort;
  settings?: SettingsRepository;
  clock: ClockPort;
  logger: Logger;
};

export type PackageFullDeliveryAssets = (input: {
  sessionId: string;
  /** Language-neutral master encode (usually full-youtube.mp4). */
  masterSourcePath: string;
  voiceOvers: VoiceOverPackage[];
  analysis: RaceAnalysis;
  editorial?: EditorialPackage | null;
}) => Promise<DeliveryAssetBundle>;

function narrationDurationMs(voiceOver: VoiceOverPackage): number | undefined {
  const lastWord = voiceOver.words[voiceOver.words.length - 1];
  return lastWord && lastWord.endMs > 0 ? lastWord.endMs : undefined;
}

export function createPackageFullDeliveryAssets(
  deps: Dependencies,
): PackageFullDeliveryAssets {
  const log = deps.logger.child({ operation: "packageFullDeliveryAssets" });

  return async (input) => {
    const startedAt = performance.now();
    const { sessionId } = input;
    log.info("Packaging full-race delivery assets", {
      sessionId,
      masterSourcePath: input.masterSourcePath,
      voCount: input.voiceOvers.length,
    });

    const deliveryDir = deps.mediaStore.replayDeliveryDir?.(sessionId);
    const masterPath = deps.mediaStore.fullReplayMasterPath?.(sessionId);
    const mixAudio = deps.fullVoMix.mixAudioTrack?.bind(deps.fullVoMix);
    const mixedPath = deps.mediaStore.fullReplayMixedAudioPath?.bind(
      deps.mediaStore,
    );
    const writeText = deps.mediaStore.writeText?.bind(deps.mediaStore);
    if (!deliveryDir || !masterPath || !mixAudio || !mixedPath || !writeText) {
      throw new Error(
        "Media store / mixer missing single-master delivery methods",
      );
    }

    await fs.mkdir(deliveryDir, { recursive: true });
    await fs.copyFile(input.masterSourcePath, masterPath);

    const appSettings = await deps.settings?.get();
    const duckDb = appSettings?.voiceDuckDb ?? -12;
    const byLang = new Map(
      input.voiceOvers.map((voiceOver) => [voiceOver.language, voiceOver]),
    );
    const it = byLang.get("it");
    const en = byLang.get("en");
    if (!it || !en) {
      throw new Error("IT and EN voice-over packages are required for packaging");
    }

    const audioIt = await mixAudio({
      videoPath: masterPath,
      voiceAudioPath: it.audioPath,
      outputPath: mixedPath(sessionId, "it"),
      voiceDuckDb: duckDb,
      voiceDurationMs: narrationDurationMs(it),
    });
    const audioEn = await mixAudio({
      videoPath: masterPath,
      voiceAudioPath: en.audioPath,
      outputPath: mixedPath(sessionId, "en"),
      voiceDuckDb: duckDb,
      voiceDurationMs: narrationDurationMs(en),
    });

    const analysisPath = path.join(deliveryDir, "race_analysis.json");
    const metadataPath = path.join(deliveryDir, "youtube_metadata.json");
    const thumbnailConceptPath = path.join(
      deliveryDir,
      "thumbnail_concept.json",
    );

    await writeText(analysisPath, JSON.stringify(input.analysis, null, 2));

    const thumbnailConcept: ThumbnailConcept = input.editorial
      ?.thumbnailConcept ?? {
      universalText: input.analysis.potentialHooks[0] ?? null,
      textIt: null,
      textEn: null,
      rationale: input.analysis.whyWatch,
    };
    await writeText(
      thumbnailConceptPath,
      JSON.stringify(thumbnailConcept, null, 2),
    );

    const thumbs = await createSvgThumbnailRenderer({ logger: log }).render({
      concept: thumbnailConcept,
      outputDir: deliveryDir,
      preferUniversal: Boolean(thumbnailConcept.universalText),
    });

    const subtitlesIt = it.srtPath
      ? path.join(deliveryDir, "subtitles_it.srt")
      : null;
    const subtitlesEn = en.srtPath
      ? path.join(deliveryDir, "subtitles_en.srt")
      : null;
    if (it.srtPath && subtitlesIt) {
      await fs.copyFile(it.srtPath, subtitlesIt);
    }
    if (en.srtPath && subtitlesEn) {
      await fs.copyFile(en.srtPath, subtitlesEn);
    }

    const manualStudioChecklist = [
      "Attach secondary audio track(s) in YouTube Studio (audio_it / audio_en from delivery folder) if multi-audio is not available via API.",
      "Verify localized titles/descriptions appear for IT and EN viewers.",
      "Upload localized thumbnails in Studio when thumbnail_it/en assets are produced.",
    ];

    const metadata = createYoutubeMetadataDocument({
      originalLanguage: "it",
      contentKind: "full",
      masterVideo: masterPath,
      requiresLocalizedRender: false,
      it: {
        title: it.title,
        description: it.description,
        audio: audioIt.outputPath,
        subtitles: subtitlesIt,
        thumbnail: thumbs.itPath ?? thumbs.universalPath,
      },
      en: {
        title: en.title,
        description: en.description,
        audio: audioEn.outputPath,
        subtitles: subtitlesEn,
        thumbnail: thumbs.enPath ?? thumbs.universalPath,
      },
      manualStudioChecklist,
    });
    await writeText(metadataPath, JSON.stringify(metadata, null, 2));

    const bundle: DeliveryAssetBundle = {
      sessionId,
      raceAnalysisPath: analysisPath,
      youtubeMetadataPath: metadataPath,
      masterVideoPath: masterPath,
      audioItPath: audioIt.outputPath,
      audioEnPath: audioEn.outputPath,
      subtitlesItPath: subtitlesIt,
      subtitlesEnPath: subtitlesEn,
      thumbnailItPath: thumbs.itPath ?? thumbs.universalPath,
      thumbnailEnPath: thumbs.enPath ?? thumbs.universalPath,
      thumbnailConcept,
      metadata,
    };

    const session = await deps.replaySessions.getById(sessionId);
    if (!session) {
      throw new Error(`Replay session not found: ${sessionId}`);
    }
    await deps.replaySessions.save({
      ...session,
      deliveryAssets: bundle,
      publishManualChecklist: manualStudioChecklist,
      updatedAt: deps.clock.now(),
    });

    log.info("Full-race delivery assets packaged", {
      sessionId,
      masterPath,
      audioIt: audioIt.outputPath,
      audioEn: audioEn.outputPath,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return bundle;
  };
}
