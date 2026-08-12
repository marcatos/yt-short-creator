import { applyCandidateEvent } from "@/src/domain/approval";
import type { RenderJob, ShortCandidate } from "@/src/domain/entities";
import { isJobCancelledError, isJobPausedError } from "@/src/domain/queue-control";
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
  clock: ClockPort;
};

const JOB_TYPE = "render_short";

async function renderInputForCandidate(
  candidate: ShortCandidate,
  deps: Dependencies,
): Promise<RenderInput> {
  const brand = await deps.brandPack.resolve();
  const common = {
    candidateId: candidate.id,
    origin: candidate.origin,
    outputPath: deps.mediaStore.renderPath(candidate.id),
    logoPath: brand.logoStackedPath,
    accentColor: brand.accentHex,
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
    voiceAssetPath: candidate.provenance.voiceAssetPath,
    timeline: candidate.provenance.timeline,
  };
}

export function createRenderShortHandler(deps: Dependencies): JobHandler {
  const log = deps.logger.child({ component: "RenderShortHandler" });

  return async (ctx) => {
    const candidateId = requireStringPayload(ctx.payload, "candidateId");
    const startedAt = performance.now();

    const found = await deps.candidates.getById(candidateId);
    if (!found) {
      throw new Error(`Candidate not found: ${candidateId}`);
    }
    let candidate: ShortCandidate = found;

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
        input = await renderInputForCandidate(candidate, deps);
      });

      await runStep(ctx, JOB_TYPE, "render", async () => {
        if (!input) {
          input = await renderInputForCandidate(candidate, deps);
        }
        ctx.setProgress(20, "Rendering 9:16 video");
        await saveJob("running", null, 20, "Rendering 9:16 video");
        result = await deps.render.render(input, { signal: ctx.signal });

        candidate = {
          ...applyCandidateEvent(candidate, { type: "render_succeeded" }),
          renderOutputPath: result.outputPath,
        };
        await deps.candidates.save(candidate);
        await saveJob("succeeded", result.outputPath, 100, "Render complete");
        ctx.setProgress(100, `Rendered to ${result.outputPath}`);
      });

      let publishJobId: string | undefined;
      await runStep(ctx, JOB_TYPE, "enqueue_publish", async () => {
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
        outputPath: candidate.renderOutputPath,
        publishJobId,
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
        if (candidate.status === "rendering") {
          await deps.candidates.save(
            applyCandidateEvent(candidate, { type: "render_failed" }),
          );
        }
        await saveJob("failed", null, 100, "Render cancelled");
        log.info("render_short cancelled", { jobId: ctx.jobId, candidateId });
        throw error;
      }
      if (candidate.status === "rendering") {
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
