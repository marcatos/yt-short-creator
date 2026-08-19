import { applyCandidateEvent } from "@/src/domain/approval";
import type { RenderJob, ShortCandidate } from "@/src/domain/entities";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
import type { VoiceOverLanguage, VoiceOverPackage } from "@/src/domain/voice-over";
import { createPublishVoShortPair } from "@/src/application/publish-vo-short-pair";
import {
  isClipProvenance,
  isGenerateProvenance,
  isReplayProvenance,
} from "@/src/domain/replay";
import type { BrandPackPort } from "@/src/ports/brand-pack";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ClockPort } from "@/src/ports/clock";
import type { JobRepository } from "@/src/ports/job-repository";
import type { InspectableJobQueue } from "@/src/ports/job-queue";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import type { RenderInput, RenderPort, RenderResult } from "@/src/ports/render";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SettingsRepository } from "@/src/ports/settings-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";

import { requireStringPayload } from "./handler-utils";
import type { JobHandler } from "./job-handler-context";
import { runStep } from "./run-step";

type Dependencies = {
  logger: Logger;
  sourceVideos: SourceVideoRepository;
  replaySessions: ReplaySessionRepository;
  candidates: CandidateRepository;
  jobs: JobRepository;
  render: RenderPort;
  brandPack: BrandPackPort;
  mediaStore: MediaStorePort;
  queue: InspectableJobQueue;
  settings: SettingsRepository;
  clock: ClockPort;
};

const JOB_TYPE = "render_short";

async function renderInputForCandidate(
  candidate: ShortCandidate,
  deps: Dependencies,
  language?: VoiceOverLanguage,
): Promise<RenderInput> {
  const [brand, settings] = await Promise.all([
    deps.brandPack.resolve(),
    deps.settings.get(),
  ]);
  const voiceOver = selectVoiceOver(candidate, language);
  const voRenderPath = deps.mediaStore.voRenderPath?.bind(deps.mediaStore);
  if (voiceOver && !voRenderPath) {
    throw new Error("Media store does not support voice-over render paths");
  }
  const voiceDurationMs = voiceOver?.words.length
    ? voiceOver.words[voiceOver.words.length - 1]!.endMs
    : undefined;
  const common = {
    candidateId: candidate.id,
    origin: candidate.origin,
    outputPath: voiceOver
      ? voRenderPath!(candidate.id, voiceOver.language)
      : deps.mediaStore.renderPath(candidate.id),
    accentColor: brand.accentHex,
    voiceAssetPath: voiceOver?.audioPath,
    voiceDurationMs,
    assPath: settings.shortsBurnInCaptions
      ? (voiceOver?.assPath ?? undefined)
      : undefined,
    burnInCaptions: settings.shortsBurnInCaptions,
    voiceDuckDb: settings.voiceDuckDb,
  };

  if (isClipProvenance(candidate.provenance)) {
    const source = await deps.sourceVideos.getById(
      candidate.provenance.sourceVideoId,
    );
    if (!source?.localMediaPath) {
      throw new Error(
        `Local source media not found for candidate: ${candidate.id}`,
      );
    }
    return {
      ...common,
      origin: "clip",
      sourceMediaPath: source.localMediaPath,
      startMs: candidate.provenance.startMs,
      endMs: candidate.provenance.endMs,
      crop: candidate.provenance.crop,
    };
  }

  if (isReplayProvenance(candidate.provenance)) {
    const session = await deps.replaySessions.getById(
      candidate.provenance.replaySessionId,
    );
    if (!session?.mediaPath) {
      throw new Error(
        `Replay media not found for candidate: ${candidate.id}`,
      );
    }
    return {
      ...common,
      origin: "replay",
      sourceMediaPath: session.mediaPath,
      startMs: candidate.provenance.startMs,
      endMs: candidate.provenance.endMs,
      segments: candidate.provenance.segments,
      crop: candidate.provenance.crop,
    };
  }

  if (!isGenerateProvenance(candidate.provenance)) {
    throw new Error(`Unsupported provenance for candidate: ${candidate.id}`);
  }

  return {
    ...common,
    origin: "generate",
    sourceMediaPath: candidate.provenance.timeline[0]?.asset ?? "",
    voiceAssetPath: voiceOver?.audioPath ?? candidate.provenance.voiceAssetPath,
    timeline: candidate.provenance.timeline,
  };
}

function selectVoiceOver(
  candidate: ShortCandidate,
  language?: VoiceOverLanguage,
): VoiceOverPackage | undefined {
  const packages = candidate.voiceOvers ?? [];
  if (!language) return packages[0];
  const voiceOver = packages.find((item) => item.language === language);
  if (!voiceOver) {
    throw new Error(
      `Voice-over package "${language}" not found for candidate: ${candidate.id}`,
    );
  }
  return voiceOver;
}

function optionalVoiceOverLanguage(
  payload: Record<string, unknown>,
): VoiceOverLanguage | undefined {
  const language = payload.language;
  if (language === undefined) return undefined;
  if (language !== "it" && language !== "en") {
    throw new Error('Job payload "language" must be "it" or "en"');
  }
  return language;
}

export function createRenderShortHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ component: "RenderShortHandler" });
  const publishVoShortPair = createPublishVoShortPair({
    candidates: deps.candidates,
    queue: deps.queue,
    logger: deps.logger,
  });

  return async (ctx) => {
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    const language = optionalVoiceOverLanguage(ctx.payload);
    const startedAt = performance.now();

    const found = await deps.candidates.getById(candidateId);
    if (!found) {
      throw new Error(`Candidate not found: ${candidateId}`);
    }
    let candidate: ShortCandidate = found;
    const renderedVoiceOver = selectVoiceOver(candidate, language);

    const existingJob = await deps.jobs.getRenderJobByCandidateId(candidateId);
    const renderJobId = existingJob?.id ?? ctx.jobId;
    const createdAt = existingJob?.createdAt ?? deps.clock.now();

    const saveJob = async (
      status: RenderJob["status"],
      outputPath: string | null,
      progressPct: number,
      message: string,
    ) => {
      await deps.jobs.saveRenderJob({
        id: renderJobId,
        candidateId,
        status,
        outputPath,
        progressPct,
        message,
        createdAt,
        updatedAt: deps.clock.now(),
      });
    };

    log.info("render_short started", {
      jobId: ctx.jobId,
      candidateId,
      origin: candidate.origin,
      voiceOverLanguage: language ?? candidate.voiceOvers?.[0]?.language,
    });

    let input: RenderInput | undefined;
    let result: RenderResult | undefined;

    try {
      await runStep(ctx, JOB_TYPE, "prepare", async () => {
        if (candidate.status === "approved") {
          candidate = applyCandidateEvent(candidate, { type: "enqueue_render" });
          await deps.candidates.save(candidate);
        } else if (candidate.status !== "rendering") {
          throw new Error(
            `Candidate cannot render in status "${candidate.status}"`,
          );
        }
        ctx.setProgress(5, "Preparing brand assets");
        await saveJob("running", null, 5, "Preparing brand assets");
        input = await renderInputForCandidate(candidate, deps, language);
      });

      await runStep(ctx, JOB_TYPE, "render", async () => {
        if (!input) {
          input = await renderInputForCandidate(candidate, deps, language);
        }
        ctx.setProgress(20, "Rendering 9:16 video");
        await saveJob("running", null, 20, "Rendering 9:16 video");
        result = await deps.render.render(input, { signal: ctx.signal });

        if (renderedVoiceOver) {
          const freshCandidate =
            (await deps.candidates.getById(candidateId)) ?? candidate;
          candidate = {
            ...freshCandidate,
            voiceOvers: (freshCandidate.voiceOvers ?? []).map((voiceOver) =>
              voiceOver.language === renderedVoiceOver.language
                ? { ...voiceOver, renderOutputPath: result!.outputPath }
                : voiceOver,
            ),
            updatedAt: deps.clock.now(),
          };
          const renderedLanguages = new Set(
            (candidate.voiceOvers ?? [])
              .filter(
                (voiceOver) =>
                  voiceOver.renderOutputPath && voiceOver.srtPath,
              )
              .map((voiceOver) => voiceOver.language),
          );
          if (
            candidate.status === "rendering" &&
            renderedLanguages.has("it") &&
            renderedLanguages.has("en")
          ) {
            candidate = applyCandidateEvent(candidate, {
              type: "render_succeeded",
            });
          }
        } else {
          candidate = {
            ...applyCandidateEvent(candidate, { type: "render_succeeded" }),
            renderOutputPath: result.outputPath,
          };
        }
        await deps.candidates.save(candidate);
        await saveJob("succeeded", result.outputPath, 100, "Render complete");
        ctx.setProgress(100, `Rendered to ${result.outputPath}`);
      });

      let publishJobId: string | undefined;
      await runStep(ctx, JOB_TYPE, "enqueue_publish", async () => {
        if (renderedVoiceOver) {
          const readyCandidate =
            (await deps.candidates.getById(candidateId)) ?? candidate;
          const readyLanguages = new Set(
            (readyCandidate.voiceOvers ?? [])
              .filter(
                (voiceOver) =>
                  voiceOver.renderOutputPath && voiceOver.srtPath,
              )
              .map((voiceOver) => voiceOver.language),
          );
          if (readyLanguages.has("it") && readyLanguages.has("en")) {
            const publishJobIds = await publishVoShortPair({ candidateId });
            publishJobId = publishJobIds.join(",");
          }
          return;
        }
        const existingPublishJob = deps.queue.listJobs().find(
          (job) =>
            job.type === "publish_short" &&
            job.payload.candidateId === candidateId &&
            ["queued", "running", "paused", "succeeded"].includes(job.status),
        );
        if (existingPublishJob) {
          publishJobId = existingPublishJob.id;
          log.info("publish_short enqueue skipped", {
            jobId: ctx.jobId,
            candidateId,
            existingPublishJobId: existingPublishJob.id,
            existingPublishJobStatus: existingPublishJob.status,
          });
          return;
        }
        publishJobId = await deps.queue.enqueue({
          type: "publish_short",
          payload: { candidateId },
        });
      });

      log.info("render_short completed", {
        jobId: ctx.jobId,
        candidateId,
        outputPath: result?.outputPath,
        publishJobId,
        voiceOverLanguage: language ?? candidate.voiceOvers?.[0]?.language,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (isJobPausedError(error)) {
        // Pausing must not release the candidate: it stays in "rendering"
        // so resume can continue the same in-flight render.
        log.info("render_short paused", { jobId: ctx.jobId, candidateId });
        throw error;
      }
      if (isJobCancelledError(error)) {
        // Cancellation is terminal, so the candidate and job row must both
        // be marked failed: this lets retry work and keeps orphan repair
        // (recoverQueue) from re-enqueuing work the user explicitly cancelled.
        if (!renderedVoiceOver && candidate.status === "rendering") {
          await deps.candidates.save(
            applyCandidateEvent(candidate, { type: "render_failed" }),
          );
        }
        await saveJob("failed", null, 100, "Render cancelled");
        log.info("render_short cancelled", { jobId: ctx.jobId, candidateId });
        throw error;
      }
      if (!renderedVoiceOver && candidate.status === "rendering") {
        await deps.candidates.save(
          applyCandidateEvent(candidate, { type: "render_failed" }),
        );
      }
      await saveJob("failed", null, 100, "Render failed");
      log.error("render_short failed", {
        jobId: ctx.jobId,
        candidateId,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };
}
