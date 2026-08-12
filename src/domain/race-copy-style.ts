/**
 * Channel copy + VO style locked from the Oschersleben full-upload rewrite
 * (YouTube `_0H55Bo383k`): first-person driver narrative, concrete race facts.
 *
 * "42" is the race number and Marcato is the driver's surname — not a marketing
 * brand to stamp into every sentence. Prefer "io", positions, and car cues.
 */

export const RACE_NARRATIVE_STYLE = `
Write in first person as the driver: Simone Marcato, race number 42
(car: white/black/green with π, typically GR86 in iRacing).
Do NOT treat "S.Marcato 42 Racing" as a brand name to repeat. Avoid stuffing
"S.Marcato 42 Racing" into titles, VO, or every sentence — say "io", "la mia
macchina", "il 42", or "π" only when it helps identify the car on screen.
Be concrete and honest: start/finish positions, quali outcome, overtakes, mistakes,
tire/strategy notes, and when luck vs skill mattered. Prefer specific track features
(e.g. chicane, defense on the inside) over generic hype.
Tone: punchy simracing YouTube, not robotic newsreader, not third-person "hero car" commentary.
Never invent results, positions, or incidents absent from the supplied race data.
Generate Italian first; English is an adaptation (same facts and energy, not a calque).
`.trim();

/** Title/description for YouTube uploads (full + Shorts metadata). */
export const RACE_METADATA_STYLE = `
${RACE_NARRATIVE_STYLE}
Titles: short hook with the race outcome or drama (e.g. position swing + track + car), max ~90 chars.
Do not start titles with "S.Marcato 42 Racing…".
Descriptions: lead with the first-person race story; then optional CTA to subscribe;
then chapters/timestamps if known; optional rig/setup block and hashtags are allowed in
the written description but are NOT part of the spoken voice-over.
`.trim();

/**
 * Spoken VO only — race story + light CTA. Do not read chapters list, rig specs,
 * or hashtag blocks aloud.
 */
export const RACE_VOICE_OVER_STYLE = `
${RACE_NARRATIVE_STYLE}
This text will be spoken aloud. Narrate only the race story (and a short subscribe CTA
mid and/or end). Do not speak chapter timestamps, PC/rig specs, or hashtag lists.
Do not repeatedly say the driver/team name — viewers already know who is driving.
`.trim();

/** @deprecated Prefer ttsInstructionsFor(language). Kept for EN default / tests. */
export const BRAND_TTS_INSTRUCTIONS =
  "Young adult male simracing YouTuber. Energetic, clear, concrete about the race. Natural pace — not slow, not robotic, not a mature woman narrator.";

const TTS_INSTRUCTIONS_IT = `
Speak Italian as a young adult man in his mid-20s (Simone Marcato, race driver).
Bright, youthful, slightly street-smart YouTube energy — NOT a mature woman, NOT a
formal newsreader, NOT slow or sleepy. Brisk natural pace, punchy rhythm, clear
consonants. Sound excited about overtakes without shouting. Keep it first-person.
`.trim();

const TTS_INSTRUCTIONS_EN = `
Speak English as a young adult male simracing YouTuber. Energetic and clear, natural
pace, concrete about the race. Not robotic, not a mature newsreader voice.
`.trim();

export function ttsInstructionsFor(language: "it" | "en"): string {
  return language === "it" ? TTS_INSTRUCTIONS_IT : TTS_INSTRUCTIONS_EN;
}
