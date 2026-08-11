import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import type { ClipProvenance } from "@/src/domain/entities";
import { getContainer } from "@/src/lib/container";

type RouteContext = { params: Promise<{ id: string }> };

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const container = getContainer();
    const candidate = await container.getCandidate({ candidateId: id });
    let mediaPath = candidate.renderOutputPath;
    if (!mediaPath && candidate.origin === "clip") {
      const provenance = candidate.provenance as ClipProvenance;
      mediaPath = (
        await container.repositories.sourceVideos.getById(provenance.sourceVideoId)
      )?.localMediaPath ?? null;
    }
    if (!mediaPath) {
      return NextResponse.json({ error: "Preview is not available" }, { status: 404 });
    }

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
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType(mediaPath),
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview is not available" }, { status: 404 });
  }
}
