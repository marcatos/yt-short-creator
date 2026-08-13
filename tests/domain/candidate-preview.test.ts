import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_CANDIDATE_PREVIEW_BYTES,
  resolveCandidatePreviewMedia,
  replayProxyVideoFileName,
} from "@/src/domain/candidate-preview";

describe("resolveCandidatePreviewMedia", () => {
  const sizes = new Map<string, number>([
    ["C:/renders/short.mp4", 20_000_000],
    ["C:/media/replays/s1/proxy.mp4", 25_000_000],
    ["C:/media/replays/s1/full-youtube.mp4", 2_500_000_000],
    ["C:/Videos/obs-master.mkv", 29_000_000_000],
    ["C:/sources/clip.mp4", 80_000_000],
    ["C:/sources/huge-clip.mp4", MAX_CANDIDATE_PREVIEW_BYTES + 1],
  ]);

  const exists = (filePath: string) => sizes.has(filePath);
  const sizeBytes = (filePath: string) => sizes.get(filePath) ?? 0;

  it("prefers render over proxy", () => {
    const resolved = resolveCandidatePreviewMedia({
      candidates: [
        { path: "C:/renders/short.mp4", kind: "render" },
        { path: "C:/media/replays/s1/proxy.mp4", kind: "proxy" },
      ],
      exists,
      sizeBytes,
    });
    expect(resolved).toEqual({
      path: "C:/renders/short.mp4",
      kind: "render",
    });
  });

  it("falls back to analysis proxy for unrendered replay candidates", () => {
    const resolved = resolveCandidatePreviewMedia({
      candidates: [
        { path: null, kind: "render" },
        { path: "C:/media/replays/s1/proxy.mp4", kind: "proxy" },
        { path: "C:/media/replays/s1/full-youtube.mp4", kind: "proxy" },
      ],
      exists,
      sizeBytes,
    });
    expect(resolved).toEqual({
      path: "C:/media/replays/s1/proxy.mp4",
      kind: "proxy",
    });
  });

  it("never returns oversized masters or delivery encodes", () => {
    const resolved = resolveCandidatePreviewMedia({
      candidates: [
        { path: "C:/media/replays/s1/full-youtube.mp4", kind: "proxy" },
        { path: "C:/Videos/obs-master.mkv", kind: "proxy" },
      ],
      exists,
      sizeBytes,
    });
    expect(resolved).toBeNull();
  });

  it("rejects clip sources above the preview size cap", () => {
    const resolved = resolveCandidatePreviewMedia({
      candidates: [{ path: "C:/sources/huge-clip.mp4", kind: "clip_source" }],
      exists,
      sizeBytes,
    });
    expect(resolved).toBeNull();
  });

  it("allows clip sources under the size cap", () => {
    const resolved = resolveCandidatePreviewMedia({
      candidates: [{ path: "C:/sources/clip.mp4", kind: "clip_source" }],
      exists,
      sizeBytes,
    });
    expect(resolved?.kind).toBe("clip_source");
  });

  it("exposes the analysis proxy file name", () => {
    expect(replayProxyVideoFileName()).toBe("proxy.mp4");
    expect(path.join("media", "replays", "s1", replayProxyVideoFileName())).toContain(
      "proxy.mp4",
    );
  });
});
