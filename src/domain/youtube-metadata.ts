import type { VoiceOverLanguage } from "./voice-over";

/**
 * Asset-generation metadata independent of YouTube API completeness.
 * Multi-audio may remain a Studio step even when paths are filled here.
 */

export type LocalizedVideoAssets = {
  title: string;
  description: string;
  audio: string | null;
  subtitles: string | null;
  thumbnail: string | null;
};

export type YoutubeMetadataDocument = {
  originalLanguage: VoiceOverLanguage;
  contentKind: "full" | "short";
  masterVideo: string | null;
  /** True when IT/EN need separate video files (burned-in language). */
  requiresLocalizedRender: boolean;
  localizations: Record<VoiceOverLanguage, LocalizedVideoAssets>;
  /**
   * Steps the automated publish adapter could not complete (e.g. attach
   * secondary audio track in YouTube Studio).
   */
  manualStudioChecklist: string[];
};

export type ThumbnailConcept = {
  /** Universal copy preferred when language-neutral (e.g. "P18 → P8"). */
  universalText: string | null;
  textIt: string | null;
  textEn: string | null;
  rationale: string;
};

export type DeliveryAssetBundle = {
  sessionId: string;
  raceAnalysisPath: string;
  youtubeMetadataPath: string;
  masterVideoPath: string | null;
  audioItPath: string | null;
  audioEnPath: string | null;
  subtitlesItPath: string | null;
  subtitlesEnPath: string | null;
  thumbnailItPath: string | null;
  thumbnailEnPath: string | null;
  thumbnailConcept: ThumbnailConcept | null;
  metadata: YoutubeMetadataDocument;
};

export function emptyLocalizedAssets(
  title = "",
  description = "",
): LocalizedVideoAssets {
  return {
    title,
    description,
    audio: null,
    subtitles: null,
    thumbnail: null,
  };
}

export function createYoutubeMetadataDocument(input: {
  originalLanguage?: VoiceOverLanguage;
  contentKind: "full" | "short";
  masterVideo?: string | null;
  requiresLocalizedRender?: boolean;
  it: LocalizedVideoAssets;
  en: LocalizedVideoAssets;
  manualStudioChecklist?: string[];
}): YoutubeMetadataDocument {
  return {
    originalLanguage: input.originalLanguage ?? "it",
    contentKind: input.contentKind,
    masterVideo: input.masterVideo ?? null,
    requiresLocalizedRender: input.requiresLocalizedRender ?? false,
    localizations: {
      it: input.it,
      en: input.en,
    },
    manualStudioChecklist: input.manualStudioChecklist ?? [],
  };
}
