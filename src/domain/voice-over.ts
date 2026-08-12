import { createHash } from "node:crypto";

export type VoiceOverLanguage = "it" | "en";

export type TimedWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type VoiceOverPackage = {
  language: VoiceOverLanguage;
  script: string;
  voiceProfile: string;
  audioPath: string;
  words: TimedWord[];
  srtPath: string | null;
  assPath: string | null;
  scriptHash: string;
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

function srtStamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const milli = ms % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

/** Group words into ~1 line cues (max ~42 chars or 1.5s gap). */
export function buildSrt(words: TimedWord[]): string {
  if (!words.length) return "";
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  let buf: TimedWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({
      startMs: buf[0]!.startMs,
      endMs: buf[buf.length - 1]!.endMs,
      text: buf.map((w) => w.text).join(" "),
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
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(cue.endMs)}\n${cue.text}\n`,
    )
    .join("\n");
}

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
  if (!words.length) return header;
  const start = words[0]!.startMs;
  const end = words[words.length - 1]!.endMs;
  const assTime = (ms: number) => {
    const cs = Math.floor(ms / 10);
    const h = Math.floor(cs / 360_000);
    const m = Math.floor((cs % 360_000) / 6_000);
    const s = Math.floor((cs % 6_000) / 100);
    const c = cs % 100;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  };
  let text = "";
  let cursor = start;
  for (const word of words) {
    const gapCs = Math.max(0, Math.round((word.startMs - cursor) / 10));
    if (gapCs > 0) text += `{\\k${gapCs}}`;
    const durCs = Math.max(1, Math.round((word.endMs - word.startMs) / 10));
    text += `{\\k${durCs}}${word.text} `;
    cursor = word.endMs;
  }
  return `${header}Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text.trim()}\n`;
}
