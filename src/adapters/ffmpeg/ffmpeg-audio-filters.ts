const DEFAULT_DUCK_DB = -12;

export function voiceDuckVolume(db: number | undefined): string {
  const normalizedDb = db !== undefined && Number.isFinite(db) ? db : DEFAULT_DUCK_DB;
  return Math.pow(10, normalizedDb / 20).toFixed(6);
}

/** Ducked source audio mixed under a full-volume voice-over track. */
export function duckedVoiceMixFilter(input: {
  sourceAudioLabel: string;
  voiceAudioLabel: string;
  voiceDuckDb?: number;
}): string[] {
  return [
    `[${input.sourceAudioLabel}]volume=${voiceDuckVolume(input.voiceDuckDb)}[ga]`,
    `[${input.voiceAudioLabel}]volume=1[va]`,
    "[ga][va]amix=inputs=2:duration=first:dropout_transition=0[aout]",
  ];
}

/** FFmpeg filter arguments treat `:` and `'` as syntax, even in Windows paths. */
export function filterFilename(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}
