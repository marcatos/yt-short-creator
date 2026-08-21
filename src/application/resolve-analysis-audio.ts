import type {
  AnalysisAudioSourceKind,
} from "@/src/domain/commentary-markers";

export type ResolvedAnalysisAudio = {
  /** Extensible: future `both` without rewriting callers. */
  kind: AnalysisAudioSourceKind;
  path: string;
  offsetMs: number;
};

/**
 * Choose which audio Whisper should read for FASE A.
 * Commentary present → commentary only (v1). Else muxed proxy audio.
 */
export function resolveAnalysisAudio(input: {
  commentaryPath: string | null | undefined;
  commentaryOffsetMs?: number | null;
  muxedAudioPath: string;
}): ResolvedAnalysisAudio {
  const commentary = input.commentaryPath?.trim();
  if (commentary) {
    const offset =
      typeof input.commentaryOffsetMs === "number" &&
      Number.isFinite(input.commentaryOffsetMs)
        ? Math.trunc(input.commentaryOffsetMs)
        : 0;
    return {
      kind: "commentary",
      path: commentary,
      offsetMs: offset,
    };
  }
  return {
    kind: "muxed",
    path: input.muxedAudioPath,
    offsetMs: 0,
  };
}
