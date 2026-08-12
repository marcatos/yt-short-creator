export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
  language: string | null;
};

export interface TranscriptionPort {
  transcribe(audioPath: string): Promise<TranscriptionResult>;
}
