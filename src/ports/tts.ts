export type TtsSynthesizeInput = {
  text: string;
  voiceProfile: string;
  outputPath: string;
};

export type TtsSynthesizeResult = {
  durationMs: number;
};

export interface TtsPort {
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}
