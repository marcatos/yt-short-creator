import type { ShortCandidate } from "@/src/domain/entities";
import type { VoiceOverLanguage } from "@/src/domain/voice-over";

export type ReelPublishSource = {
  filePath: string;
  title: string;
  description: string;
};

export function resolveItalianReelSource(
  candidate: ShortCandidate,
): ReelPublishSource | null {
  const italianVoiceOver = candidate.voiceOvers?.find(
    (voiceOver) => voiceOver.language === "it",
  );
  if (italianVoiceOver?.renderOutputPath) {
    return {
      filePath: italianVoiceOver.renderOutputPath,
      title: italianVoiceOver.title || candidate.title,
      description: italianVoiceOver.description || candidate.description,
    };
  }
  if (candidate.renderOutputPath) {
    return {
      filePath: candidate.renderOutputPath,
      title: candidate.title,
      description: candidate.description,
    };
  }
  return null;
}

export function shouldEnqueueReelAfterRender(
  language: VoiceOverLanguage | undefined,
  voiceOvers: ShortCandidate["voiceOvers"],
): boolean {
  const packages = voiceOvers ?? [];
  const hasItalian = packages.some((voiceOver) => voiceOver.language === "it");
  if (hasItalian) {
    return language === "it";
  }
  return language === undefined;
}
