import { createHash } from "node:crypto";

export type VoiceOverLanguage = "it" | "en";

export { BRAND_TTS_INSTRUCTIONS } from "./race-copy-style";

export type TimedWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type VoiceOverPackage = {
  language: VoiceOverLanguage;
  script: string;
  title: string;
  description: string;
  voiceProfile: string;
  audioPath: string;
  words: TimedWord[];
  srtPath: string | null;
  assPath: string | null;
  scriptHash: string;
  renderOutputPath?: string | null;
  youtubeVideoId?: string | null;
  youtubeCaptionId?: string | null;
};

export function hashVoiceScript(
  script: string,
  voiceProfile: string,
  language: VoiceOverLanguage,
): string {
  return createHash("sha256")
    .update(`${language}\n${voiceProfile}\n${script.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

export type NarrationChunkLimits = {
  maxWords: number;
  maxChars: number;
};

/**
 * gpt-4o-mini-tts rejects inputs above 4096 characters, and Italian narration
 * averages well over 5 characters per word, so the character cap — not the word
 * budget — is what a 700-word chapter actually hits first.
 */
export const TTS_CHUNK_LIMITS: NarrationChunkLimits = {
  maxWords: 700,
  maxChars: 3_500,
};

const CHUNK_SEPARATOR = "\n\n";

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Word-by-word split for a sentence that alone busts either budget. */
function hardSplitSentence(
  sentence: string,
  limits: NarrationChunkLimits,
): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let chars = 0;

  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    const separator = current.length ? 1 : 0;
    if (
      current.length &&
      (current.length + 1 > limits.maxWords ||
        chars + separator + word.length > limits.maxChars)
    ) {
      pieces.push(current.join(" "));
      current = [];
      chars = 0;
    }
    chars += (current.length ? 1 : 0) + word.length;
    current.push(word);
  }
  if (current.length) pieces.push(current.join(" "));
  return pieces;
}

/** Sentence-sized pieces that fit both budgets, hard-splitting long sentences. */
function splitOversizedSegment(
  segment: string,
  limits: NarrationChunkLimits,
): string[] {
  const sentences = segment.match(/[^.!?]+[.!?]*\s*/g) ?? [segment];
  const pieces: string[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let bufferChars = 0;

  const flush = () => {
    if (!buffer.length) return;
    pieces.push(buffer.join(" "));
    buffer = [];
    bufferWords = 0;
    bufferChars = 0;
  };

  const append = (sentence: string, words: number) => {
    if (
      buffer.length &&
      (bufferWords + words > limits.maxWords ||
        bufferChars + 1 + sentence.length > limits.maxChars)
    ) {
      flush();
    }
    bufferChars += (buffer.length ? 1 : 0) + sentence.length;
    buffer.push(sentence);
    bufferWords += words;
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const words = countWords(sentence);
    if (words > limits.maxWords || sentence.length > limits.maxChars) {
      flush();
      for (const piece of hardSplitSentence(sentence, limits)) {
        pieces.push(piece);
      }
      continue;
    }
    append(sentence, words);
  }
  flush();
  return pieces;
}

/**
 * Groups narration segments (chapters) into TTS-sized chunks so a full-race
 * script never exceeds the provider's per-call word or character limit.
 */
export function chunkNarration(
  segments: string[],
  limits: NarrationChunkLimits,
): string[] {
  if (limits.maxWords < 1) {
    throw new Error("chunkNarration requires maxWords >= 1");
  }
  if (limits.maxChars < 1) {
    throw new Error("chunkNarration requires maxChars >= 1");
  }
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  let currentChars = 0;

  const append = (text: string, words: number) => {
    if (
      current.length &&
      (currentWords + words > limits.maxWords ||
        currentChars + CHUNK_SEPARATOR.length + text.length > limits.maxChars)
    ) {
      chunks.push(current.join(CHUNK_SEPARATOR));
      current = [];
      currentWords = 0;
      currentChars = 0;
    }
    currentChars += (current.length ? CHUNK_SEPARATOR.length : 0) + text.length;
    current.push(text);
    currentWords += words;
  };

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const words = countWords(trimmed);
    if (words <= limits.maxWords && trimmed.length <= limits.maxChars) {
      append(trimmed, words);
      continue;
    }
    for (const piece of splitOversizedSegment(trimmed, limits)) {
      append(piece, countWords(piece));
    }
  }
  if (current.length) chunks.push(current.join(CHUNK_SEPARATOR));
  return chunks;
}

/** Shifts chunk-local word timings onto the concatenated audio timeline. */
export function offsetWords(words: TimedWord[], offsetMs: number): TimedWord[] {
  if (offsetMs === 0) return words;
  return words.map((word) => ({
    text: word.text,
    startMs: word.startMs + offsetMs,
    endMs: word.endMs + offsetMs,
  }));
}

function srtStamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const milli = ms % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function assTime(ms: number): string {
  const cs = Math.floor(ms / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Escape ASS override-control characters inside spoken text. */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

export type CaptionCue = {
  startMs: number;
  endMs: number;
  words: TimedWord[];
};

/**
 * Group words into short on-screen cues (≈1 line / ≤42 chars, or a 1.5s gap).
 * Shared by soft SRT and burn-in ASS so captions advance with speech.
 */
export function groupWordsIntoCues(words: TimedWord[]): CaptionCue[] {
  if (!words.length) return [];
  const cues: CaptionCue[] = [];
  let buf: TimedWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({
      startMs: buf[0]!.startMs,
      endMs: buf[buf.length - 1]!.endMs,
      words: buf,
    });
    buf = [];
  };
  for (const word of words) {
    const nextLen =
      buf.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    const gap =
      buf.length > 0 ? word.startMs - buf[buf.length - 1]!.endMs : 0;
    if (buf.length && (nextLen > 42 || gap > 1_500)) flush();
    buf.push(word);
  }
  flush();
  return cues;
}

/** Soft captions: one cue at a time (same grouping as burn-in). */
export function buildSrt(words: TimedWord[]): string {
  const cues = groupWordsIntoCues(words);
  if (!cues.length) return "";
  return cues
    .map((cue, i) => {
      const text = cue.words.map((w) => w.text).join(" ");
      return `${i + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(cue.endMs)}\n${text}\n`;
    })
    .join("\n");
}

/**
 * Burn-in captions: one Dialogue event per cue so only the current phrase is
 * on screen. Within the cue, `\k` highlights the active word as it is spoken
 * (karaoke fill) without revealing the rest of the narration early.
 */
export function buildAssKaraoke(words: TimedWord[]): string {
  const header = `[Script Info]
Title: S.Marcato VO
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const cues = groupWordsIntoCues(words);
  if (!cues.length) return header;

  const dialogues = cues.map((cue) => {
    let text = "";
    let cursor = cue.startMs;
    for (const word of cue.words) {
      const gapCs = Math.max(0, Math.round((word.startMs - cursor) / 10));
      if (gapCs > 0) text += `{\\k${gapCs}}`;
      const durCs = Math.max(1, Math.round((word.endMs - word.startMs) / 10));
      text += `{\\k${durCs}}${escapeAssText(word.text)} `;
      cursor = word.endMs;
    }
    return `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${text.trim()}`;
  });

  return `${header}${dialogues.join("\n")}\n`;
}
