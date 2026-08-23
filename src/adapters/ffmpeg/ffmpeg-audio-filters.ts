const DEFAULT_DUCK_DB = -12;

/** Seconds spent easing the source back to unity once the narration stops. */
const DUCK_RELEASE_SEC = 1;

export function voiceDuckVolume(db: number | undefined): string {
  const normalizedDb = db !== undefined && Number.isFinite(db) ? db : DEFAULT_DUCK_DB;
  return Math.pow(10, normalizedDb / 20).toFixed(6);
}

/**
 * Holds the duck for the narration, then ramps the source back to unity. A
 * full race is mostly un-narrated, so a constant duck would leave the whole
 * upload 12 dB down.
 */
function gatedDuckVolume(duck: string, voiceDurationMs: number): string {
  const end = (voiceDurationMs / 1_000).toFixed(3);
  return [
    `volume='if(lt(t,${end}),${duck},`,
    `min(1,${duck}+(1-${duck})*(t-${end})/${DUCK_RELEASE_SEC}))':eval=frame`,
  ].join("");
}

/** Ducked source audio mixed under a full-volume voice-over track. */
export function duckedVoiceMixFilter(input: {
  sourceAudioLabel: string;
  voiceAudioLabel: string;
  voiceDuckDb?: number;
  /** Releases the duck after the narration ends; omit to duck throughout. */
  voiceDurationMs?: number;
}): string[] {
  const duck = voiceDuckVolume(input.voiceDuckDb);
  const gated =
    input.voiceDurationMs !== undefined &&
    Number.isFinite(input.voiceDurationMs) &&
    input.voiceDurationMs > 0;
  return [
    `[${input.sourceAudioLabel}]${
      gated ? gatedDuckVolume(duck, input.voiceDurationMs!) : `volume=${duck}`
    }[ga]`,
    `[${input.voiceAudioLabel}]volume=1[va]`,
    // normalize=0 keeps both inputs at the gains set above; amix otherwise
    // divides every input by the input count and halves the narration.
    "[ga][va]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
  ];
}

/**
 * Short render: duck game + commentary stems during Short VO, then release.
 * Commentary duck is typically deeper (e.g. -30 dB) than game duck (-12 dB).
 */
export function shortThreeWayMixFilter(input: {
  gameAudioLabel: string;
  shortVoAudioLabel: string;
  commentaryAudioLabel: string;
  voiceDuckDb?: number;
  commentaryDuckDb?: number;
  shortVoDurationMs?: number;
}): string[] {
  const gameDuck = voiceDuckVolume(input.voiceDuckDb);
  const commDuck = voiceDuckVolume(input.commentaryDuckDb);
  const gated =
    input.shortVoDurationMs !== undefined &&
    Number.isFinite(input.shortVoDurationMs) &&
    input.shortVoDurationMs > 0;
  const gameVolume = gated
    ? gatedDuckVolume(gameDuck, input.shortVoDurationMs!)
    : `volume=${gameDuck}`;
  const commVolume = gated
    ? gatedDuckVolume(commDuck, input.shortVoDurationMs!)
    : `volume=${commDuck}`;
  return [
    `[${input.gameAudioLabel}]${gameVolume}[ga]`,
    `[${input.commentaryAudioLabel}]${commVolume}[ca]`,
    `[${input.shortVoAudioLabel}]volume=1[va]`,
    "[ga][ca][va]amix=inputs=3:duration=first:dropout_transition=0:normalize=0[aout]",
  ];
}

/** FFmpeg filter arguments treat `:` and `'` as syntax, even in Windows paths. */
export function filterFilename(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}
