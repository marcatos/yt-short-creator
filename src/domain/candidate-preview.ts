/**
 * Candidate HTML5 preview must never stream OBS/iRacing masters (often 10–30+ GB).
 * Prefer rendered Short → analysis proxy → (small) clip source; refuse oversized files.
 */

export const MAX_CANDIDATE_PREVIEW_BYTES = 200 * 1024 * 1024; // 200 MiB

export type PreviewMediaKind =
  | "render"
  | "voice_over_render"
  | "proxy"
  | "clip_source";

export type PreviewMediaResolution = {
  path: string;
  kind: PreviewMediaKind;
};

export type PreviewPathCandidate = {
  path: string | null | undefined;
  kind: PreviewMediaKind;
};

/**
 * Picks the first existing preview path under the size cap.
 * Callers must NOT pass the OBS/session master as a candidate.
 */
export function resolveCandidatePreviewMedia(input: {
  candidates: PreviewPathCandidate[];
  exists: (filePath: string) => boolean;
  sizeBytes: (filePath: string) => number;
  maxBytes?: number;
}): PreviewMediaResolution | null {
  const maxBytes = input.maxBytes ?? MAX_CANDIDATE_PREVIEW_BYTES;
  for (const candidate of input.candidates) {
    const filePath = candidate.path?.trim();
    if (!filePath) continue;
    if (!input.exists(filePath)) continue;
    const size = input.sizeBytes(filePath);
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) continue;
    return { path: filePath, kind: candidate.kind };
  }
  return null;
}

/** Stable relative name under the replay analysis directory. */
export function replayProxyVideoFileName(): string {
  return "proxy.mp4";
}
