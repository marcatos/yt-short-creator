import type { VoiceOverLanguage } from "./voice-over";

export const VOICE_OVER_MODES = ["driver", "commentator"] as const;
export type VoiceOverMode = (typeof VOICE_OVER_MODES)[number];

export const COMMENTARY_INTENSITIES = ["low", "medium", "high"] as const;
export type CommentaryIntensity = (typeof COMMENTARY_INTENSITIES)[number];

/**
 * Third-person live motorsport commentary (David Croft / F1 UK energy).
 * Used when voiceOverMode is `commentator`.
 */
export const SPORTS_COMMENTARY_STYLE = `
Third-person live motorsport commentary in the style of UK F1 TV (David Croft energy):
build tension before battles, erupt on overtakes and incidents, stay factual.
Name drivers and positions; describe track geometry (apex, inside line, chicane).
Short punchy sentences during action; slightly longer setup lines before key moments.
Never first person; never invent facts absent from the supplied race data or timeline.
Generate Italian first; English is an adaptation (same facts and energy, not a calque).
This text will be spoken aloud — no chapter timestamps, rig specs, or hashtag lists.
`.trim();

const TTS_COMMENTARY_IT: Record<CommentaryIntensity, string> = {
  high: `
Telecronaca motorsport italiana, energia da broadcast F1. Picco sull'azione:
ritmo veloce, tono eccitato su sorpassi e contatti. Frasi brevi e incalzanti.
Non urlare costantemente; chiaro e concreto.
`.trim(),
  medium: `
Telecronaca motorsport italiana, fluida e coinvolta tra le azioni.
Ritmo sostenuto, tono vivo da commentatore TV, non monotono.
`.trim(),
  low: `
Telecronaca motorsport italiana, linea di setup prima del prossimo momento chiave.
Tono analitico ma ancora vivo, non piattone da notiziario.
`.trim(),
};

const TTS_COMMENTARY_EN: Record<CommentaryIntensity, string> = {
  high: `
British male F1 TV commentator, David Croft style — build tension then explode
on the overtake or contact. Clear broadcast diction, brisk pace, not shouting constantly.
`.trim(),
  medium: `
British F1 TV commentator, engaged live energy, brisk pace between battles.
Clear diction, natural broadcast rhythm.
`.trim(),
  low: `
British F1 commentator, analytical setup line before the next action.
Still alive and engaged, not monotone newsreader.
`.trim(),
};

export function ttsInstructionsForCommentary(
  language: VoiceOverLanguage,
  intensity: CommentaryIntensity,
): string {
  const table = language === "it" ? TTS_COMMENTARY_IT : TTS_COMMENTARY_EN;
  return table[intensity];
}

/** Heuristic prosody tag from spoken chunk text (no LLM round-trip). */
export function commentaryIntensityForText(text: string): CommentaryIntensity {
  const sample = text.trim();
  if (!sample) return "medium";
  if (
    /\b(side by side|overtake|contact|incident|crash|punt|inside|attacca|sorpasso|contatto|collision)\b/i.test(
      sample,
    )
  ) {
    return "high";
  }
  if (
    /\b(strategy|tyre|tire|fuel|half|lap \d|giro \d|metà gara|strategia|gomme)\b/i.test(
      sample,
    )
  ) {
    return "low";
  }
  return "medium";
}

export function voiceProfileForMode(
  settings: {
    brandVoiceProfile: string;
    italianVoiceProfile: string;
    commentaryVoiceProfileEn: string;
    commentaryVoiceProfileIt: string;
  },
  language: VoiceOverLanguage,
  mode: VoiceOverMode,
): string {
  if (mode === "commentator") {
    return language === "it"
      ? settings.commentaryVoiceProfileIt
      : settings.commentaryVoiceProfileEn;
  }
  return language === "it"
    ? settings.italianVoiceProfile
    : settings.brandVoiceProfile;
}
