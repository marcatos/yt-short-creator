import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import type { ClipProvenance } from "@/src/domain/entities";
import {
  resolveCandidatePreviewMedia,
  replayProxyVideoFileName,
  type PreviewPathCandidate,
} from "@/src/domain/candidate-preview";
import { isReplayProvenance } from "@/src/domain/replay";
import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

function destroyOnAbort(
  stream: fs.ReadStream,
  signal: AbortSignal | null,
): void {
  if (!signal) return;
  const onAbort = () => {
    stream.destroy();
  };
  if (signal.aborted) {
    onAbort();
    return;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  stream.once("close", () => {
    signal.removeEventListener("abort", onAbort);
  });
}

async function resolvePreviewPath(candidateId: string): Promise<{
  mediaPath: string;
  kind: string;
} | null> {
  const container = getContainer();
  const logger = container.logger.child({
    route: "candidate-media-preview",
    candidateId,
  });
  const candidate = await container.getCandidate({ candidateId });
  const candidates: PreviewPathCandidate[] = [
    { path: candidate.renderOutputPath, kind: "render" },
  ];

  for (const voiceOver of candidate.voiceOvers ?? []) {
    if (voiceOver.renderOutputPath) {
      candidates.push({
        path: voiceOver.renderOutputPath,
        kind: "voice_over_render",
      });
    }
  }

  if (candidate.origin === "clip") {
    const provenance = candidate.provenance as ClipProvenance;
    const source = await container.repositories.sourceVideos.getById(
      provenance.sourceVideoId,
    );
    candidates.push({
      path: source?.localMediaPath ?? null,
      kind: "clip_source",
    });
  }

  if (candidate.origin === "replay" && isReplayProvenance(candidate.provenance)) {
    const session = await container.repositories.replaySessions.getById(
      candidate.provenance.replaySessionId,
    );
    if (session) {
      const analysisDir = container.mediaStore.replayAnalysisDir(session.id);
      candidates.push({
        path: path.join(analysisDir, replayProxyVideoFileName()),
        kind: "proxy",
      });
      // Intentionally omit session.mediaPath (OBS master) and full-youtube.mp4
      // (~2.4GB): both exceed the preview size cap / hang the Next process.
    }
  }

  const sizeCache = new Map<string, number>();
  const resolved = resolveCandidatePreviewMedia({
    candidates,
    exists: (filePath) => fs.existsSync(filePath),
    sizeBytes: (filePath) => {
      const cached = sizeCache.get(filePath);
      if (cached !== undefined) return cached;
      const size = fs.statSync(filePath).size;
      sizeCache.set(filePath, size);
      return size;
    },
  });

  if (!resolved) {
    logger.info("Candidate preview unavailable (no safe media)", {
      origin: candidate.origin,
      hasRender: Boolean(candidate.renderOutputPath),
    });
    return null;
  }

  logger.info("Candidate preview media resolved", {
    kind: resolved.kind,
    mediaPath: resolved.path,
  });
  return { mediaPath: resolved.path, kind: resolved.kind };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const resolved = await resolvePreviewPath(id);
    if (!resolved) {
      return NextResponse.json(
        { error: "Preview is not available" },
        { status: 404 },
      );
    }
    const { mediaPath } = resolved;

    const stats = await fsPromises.stat(mediaPath);
    const range = request.headers.get("range");
    let start = 0;
    let end = stats.size - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stats.size}` },
        });
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= stats.size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stats.size}` },
        });
      }
      status = 206;
    }

    const stream = fs.createReadStream(mediaPath, { start, end });
    destroyOnAbort(stream, request.signal);

    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new NextResponse(webStream, {
      status,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType(mediaPath),
        "X-Preview-Kind": resolved.kind,
        "Cache-Control": "private, max-age=60",
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` }
          : {}),
      },
    });
  } catch (error) {
    if (
      (error instanceof Error && error.name === "AbortError") ||
      request.signal.aborted
    ) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(
      { error: "Preview is not available" },
      { status: 404 },
    );
  }
}
