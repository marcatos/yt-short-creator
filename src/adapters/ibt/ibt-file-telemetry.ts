import fs from "node:fs/promises";

import type { ReplayEvent } from "@/src/domain/entities";
import type {
  IbtParseResult,
  IbtTelemetryPort,
} from "@/src/ports/ibt-telemetry";
import type { Logger } from "@/src/ports/logger";

const IRSDK_MAX_STRING = 32;
const IRSDK_MAX_DESC = 64;
const VAR_HEADER_SIZE = 144; // type+offset+count+countAsTime + name(32)+desc(64)+unit(32)

type VarHeader = {
  type: number;
  offset: number;
  count: number;
  name: string;
};

function readCString(buf: Buffer, offset: number, max: number): string {
  const end = Math.min(buf.length, offset + max);
  let stop = offset;
  while (stop < end && buf[stop] !== 0) stop += 1;
  return buf.subarray(offset, stop).toString("utf8");
}

function parseTrackNameFromYaml(yaml: string): string | null {
  const match =
    /TrackDisplayName:\s*(.+)/i.exec(yaml) ??
    /TrackName:\s*(.+)/i.exec(yaml) ??
    /TrackDisplayShortName:\s*(.+)/i.exec(yaml);
  return match?.[1]?.trim() || null;
}

function readNumberAt(
  buf: Buffer,
  type: number,
  absoluteOffset: number,
): number | null {
  if (absoluteOffset < 0 || absoluteOffset >= buf.length) return null;
  try {
    switch (type) {
      case 1: // bool / char
        return buf.readUInt8(absoluteOffset);
      case 2: // int
        if (absoluteOffset + 4 > buf.length) return null;
        return buf.readInt32LE(absoluteOffset);
      case 3: // bitfield
        if (absoluteOffset + 4 > buf.length) return null;
        return buf.readUInt32LE(absoluteOffset);
      case 4: // float
        if (absoluteOffset + 4 > buf.length) return null;
        return buf.readFloatLE(absoluteOffset);
      case 5: // double
        if (absoluteOffset + 8 > buf.length) return null;
        return buf.readDoubleLE(absoluteOffset);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function detectEventsFromSamples(input: {
  file: Buffer;
  vars: VarHeader[];
  bufOffset: number;
  bufLen: number;
  sampleCount: number;
  tickRate: number;
}): ReplayEvent[] {
  const speedVar = input.vars.find((v) => v.name === "Speed");
  const lapTimeVar = input.vars.find(
    (v) => v.name === "LapLastLapTime" || v.name === "LapDeltaToBestLap",
  );
  const lapVar = input.vars.find((v) => v.name === "Lap");
  if (!speedVar && !lapTimeVar) {
    return [];
  }

  const events: ReplayEvent[] = [];
  const tickRate = Math.max(1, input.tickRate || 60);
  const stride = Math.max(1, Math.floor(tickRate / 5)); // ~5 Hz scan
  let prevSpeed: number | null = null;
  let bestLapTime = Number.POSITIVE_INFINITY;
  let lastIncidentMs = -60_000;

  for (let sample = 0; sample < input.sampleCount; sample += stride) {
    const base = input.bufOffset + sample * input.bufLen;
    if (base + input.bufLen > input.file.length) break;
    const timeMs = Math.round((sample / tickRate) * 1_000);

    if (speedVar) {
      const speed = readNumberAt(input.file, speedVar.type, base + speedVar.offset);
      if (speed !== null && prevSpeed !== null && prevSpeed > 15) {
        const dropRatio = (prevSpeed - speed) / prevSpeed;
        if (dropRatio >= 0.4 && timeMs - lastIncidentMs > 15_000) {
          events.push({
            id: `ibt-incident-${timeMs}`,
            type: "incident",
            startMs: timeMs,
            endMs: timeMs,
            score: Math.min(1, 0.55 + dropRatio * 0.4),
            title: "Incident / sudden slowdown",
            hookReason: `Speed dropped ~${Math.round(dropRatio * 100)}% near ${Math.round(timeMs / 1000)}s`,
            payload: { prevSpeed, speed, timeMs },
          });
          lastIncidentMs = timeMs;
        }
      }
      if (speed !== null) prevSpeed = speed;
    }

    if (lapTimeVar) {
      const lapTime = readNumberAt(
        input.file,
        lapTimeVar.type,
        base + lapTimeVar.offset,
      );
      const lap =
        lapVar !== undefined
          ? readNumberAt(input.file, lapVar.type, base + lapVar.offset)
          : null;
      if (
        lapTime !== null &&
        lapTime > 20 &&
        lapTime < bestLapTime &&
        Number.isFinite(lapTime)
      ) {
        // Only treat as best-lap when improving a previously seen valid time.
        if (Number.isFinite(bestLapTime) && bestLapTime < Number.POSITIVE_INFINITY) {
          events.push({
            id: `ibt-bestlap-${timeMs}`,
            type: "best_lap",
            startMs: Math.max(0, timeMs - 2_000),
            endMs: timeMs,
            score: 0.85,
            title: lap !== null ? `Best lap (lap ${lap})` : "Best lap",
            hookReason: `New best lap time ${lapTime.toFixed(3)}s`,
            payload: { lapTime, lap, timeMs },
          });
        }
        bestLapTime = lapTime;
      }
    }
  }

  return events.slice(0, 20);
}

/**
 * Parses iRacing IBT telemetry for highlight heuristics.
 * Soft-fails to empty events when the binary layout cannot be read.
 */
export function createIbtFileTelemetry(deps: {
  logger: Logger;
}): IbtTelemetryPort {
  const log = deps.logger.child({ component: "IbtFileTelemetry" });

  return {
    async parse(ibtPath: string): Promise<IbtParseResult> {
      const startedAt = performance.now();
      log.info("IBT parse started", { ibtPath });

      try {
        const file = await fs.readFile(ibtPath);
        if (file.length < 112) {
          throw new Error("IBT file too small");
        }

        const ver = file.readInt32LE(0);
        const tickRate = file.readInt32LE(8);
        const sessionInfoLen = file.readInt32LE(16);
        const sessionInfoOffset = file.readInt32LE(20);
        const numVars = file.readInt32LE(24);
        const varHeaderOffset = file.readInt32LE(28);
        const numBuf = file.readInt32LE(32);
        const bufLen = file.readInt32LE(36);

        // First disk buffer offset is typically at header + 48 + n*16 for pad,
        // but recorded IBTs usually place bufOffset after var headers.
        // irsdk_header has BufOffset at byte 52 for the first buffer descriptor in memory;
        // on disk the common layout stores data immediately after headers.
        let bufOffset = 0;
        if (file.length >= 56) {
          // Attempt memory-style header buffer descriptor (offset 48+4 status + offset).
          bufOffset = file.readInt32LE(52);
        }
        if (
          bufOffset <= 0 ||
          bufOffset >= file.length ||
          numVars <= 0 ||
          numVars > 10_000 ||
          bufLen <= 0
        ) {
          // Fallback: data starts after var headers.
          bufOffset = varHeaderOffset + numVars * VAR_HEADER_SIZE;
        }

        let trackName: string | null = null;
        if (
          sessionInfoOffset > 0 &&
          sessionInfoLen > 0 &&
          sessionInfoOffset + sessionInfoLen <= file.length
        ) {
          const yaml = file
            .subarray(sessionInfoOffset, sessionInfoOffset + sessionInfoLen)
            .toString("utf8")
            .replace(/\0+$/g, "");
          trackName = parseTrackNameFromYaml(yaml);
        }

        const vars: VarHeader[] = [];
        for (let i = 0; i < numVars; i += 1) {
          const base = varHeaderOffset + i * VAR_HEADER_SIZE;
          if (base + VAR_HEADER_SIZE > file.length) break;
          vars.push({
            type: file.readInt32LE(base),
            offset: file.readInt32LE(base + 4),
            count: file.readInt32LE(base + 8),
            name: readCString(file, base + 16, IRSDK_MAX_STRING),
          });
        }

        const available = Math.max(0, file.length - bufOffset);
        const sampleCount =
          bufLen > 0 ? Math.floor(available / bufLen) : 0;

        const events =
          sampleCount > 0
            ? detectEventsFromSamples({
                file,
                vars,
                bufOffset,
                bufLen,
                sampleCount: Math.min(sampleCount, 500_000),
                tickRate,
              })
            : [];

        log.info("IBT parse completed", {
          ibtPath,
          ver,
          numVars,
          numBuf,
          sampleCount,
          eventCount: events.length,
          trackName,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return { events, trackName };
      } catch (error) {
        log.warn("IBT parse soft-failed", {
          ibtPath,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { events: [], trackName: null };
      }
    },
  };
}
