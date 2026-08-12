import type { TimedWord } from "@/src/domain/voice-over";

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptionOptions = {
  words?: boolean;
};

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
  language: string | null;
  words?: TimedWord[];
};

export interface TranscriptionPort {
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}
