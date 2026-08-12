export type AudioConcatInput = {
  /** Chunk files in playback order; a single chunk is returned as-is. */
  inputPaths: string[];
  outputPath: string;
};

export type AudioConcatResult = {
  outputPath: string;
  /** Wall-clock time spent concatenating. */
  durationMs: number;
};

export interface AudioConcatPort {
  concat(input: AudioConcatInput): Promise<AudioConcatResult>;
}

export type FullVoMixInput = {
  /** YouTube-delivery encode of the race. */
  videoPath: string;
  voiceAudioPath: string;
  outputPath: string;
  /** Race audio gain under the narration (default -12 dB). */
  voiceDuckDb?: number;
  burnInCaptions?: boolean;
  /** SRT burned into the picture when `burnInCaptions` is set. */
  subtitlesPath?: string;
};

export type FullVoMixResult = {
  outputPath: string;
  burnedInCaptions: boolean;
  /** Wall-clock time spent mixing. */
  durationMs: number;
};

export interface FullVoMixPort {
  mix(input: FullVoMixInput): Promise<FullVoMixResult>;
}
