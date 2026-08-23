import type { ReplaySession } from "./entities";
import { pathsMatch } from "./canonical-replay";

/** Derived artefacts that must be rebuilt when the underlying media file changes. */
export function stripReplayDerivedArtifacts(
  session: ReplaySession,
): ReplaySession {
  return {
    ...session,
    trackName: null,
    events: [],
    racePackage: null,
    raceAnalysis: null,
    fullVideoEncodePath: null,
    fullVoiceOvers: null,
    deliveryAssets: null,
  };
}

export function replayMediaChanged(
  previousPath: string | null | undefined,
  nextPath: string,
): boolean {
  if (!previousPath?.trim()) return false;
  return !pathsMatch(previousPath, nextPath);
}

/** True when stored analysis likely belongs to a different encode than current media. */
export function isReplayAnalysisStale(session: ReplaySession): boolean {
  const analysis = session.raceAnalysis;
  if (!analysis) return false;

  const sessionDuration = session.durationSec;
  const analyzedDuration = analysis.context?.durationSec;
  if (
    sessionDuration != null &&
    analyzedDuration != null &&
    Math.abs(analyzedDuration - sessionDuration) > 5
  ) {
    return true;
  }

  return false;
}
