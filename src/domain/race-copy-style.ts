/**
 * Channel copy + VO style locked from the Oschersleben full-upload rewrite
 * (YouTube `_0H55Bo383k`): first-person driver narrative, concrete race facts.
 */

export const RACE_NARRATIVE_STYLE = `
Write as the driver of S.Marcato 42 Racing (white/black/green π / GR86), in first person.
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
`.trim();

export const BRAND_TTS_INSTRUCTIONS =
  "First-person simracing driver for S.Marcato 42 Racing. Energetic, clear, concrete about the race. Punchy YouTube energy, not robotic, not third-person commentator fluff.";
