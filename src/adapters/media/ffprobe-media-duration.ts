import { probeMediaDurationSec } from "./ffprobe-duration";
import type { MediaDurationPort } from "@/src/ports/media-duration";

export function createFfprobeMediaDuration(
  ffprobePath = "ffprobe",
): MediaDurationPort {
  return {
    probeDurationSec(mediaPath) {
      return probeMediaDurationSec(mediaPath, ffprobePath);
    },
  };
}
