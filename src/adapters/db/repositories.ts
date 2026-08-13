import { and, eq, inArray, sql } from "drizzle-orm";

import type {
  Channel,
  GenerationBrief,
  PublishJob,
  RenderJob,
  ReplaySession,
  ShortCandidate,
  SourceVideo,
} from "@/src/domain/entities";
import type { CandidateRepository } from "@/src/ports/candidate-repository";
import type { ChannelRepository } from "@/src/ports/channel-repository";
import type { GenerationBriefRepository } from "@/src/ports/generation-brief-repository";
import type { JobRepository } from "@/src/ports/job-repository";
import type { ReplaySessionRepository } from "@/src/ports/replay-session-repository";
import type { SourceVideoRepository } from "@/src/ports/source-video-repository";

import type { AppDb } from "./client";
import {
  channels,
  generationBriefs,
  publishJobs,
  renderJobs,
  replaySessions,
  shortCandidates,
  sourceVideos,
} from "./schema";

type ChannelRow = typeof channels.$inferSelect;
type SourceVideoRow = typeof sourceVideos.$inferSelect;
type GenerationBriefRow = typeof generationBriefs.$inferSelect;
type ShortCandidateRow = typeof shortCandidates.$inferSelect;
type RenderJobRow = typeof renderJobs.$inferSelect;
type PublishJobRow = typeof publishJobs.$inferSelect;
type ReplaySessionRow = typeof replaySessions.$inferSelect;

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    youtubeChannelId: row.youtubeChannelId,
    title: row.title,
    connectedAt: row.connectedAt,
  };
}

function toSourceVideo(row: SourceVideoRow): SourceVideo {
  return {
    id: row.id,
    channelId: row.channelId,
    youtubeVideoId: row.youtubeVideoId,
    title: row.title,
    durationSec: row.durationSec,
    localMediaPath: row.localMediaPath,
    analyticsSnapshot: row.analyticsSnapshot,
    publishedAt: row.publishedAt,
    syncedAt: row.syncedAt,
  };
}

function toGenerationBrief(row: GenerationBriefRow): GenerationBrief {
  return {
    id: row.id,
    channelId: row.channelId,
    hook: row.hook,
    script: row.script,
    voiceProfile: row.voiceProfile,
    brollPlan: row.brollPlan,
    createdAt: row.createdAt,
  };
}

function toShortCandidate(row: ShortCandidateRow): ShortCandidate {
  return {
    id: row.id,
    origin: row.origin,
    status: row.status,
    title: row.title,
    description: row.description,
    tags: row.tags,
    score: row.score,
    provenance: row.provenance,
    renderOutputPath: row.renderOutputPath,
    voiceOvers: row.voiceOvers ?? null,
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRenderJob(row: RenderJobRow): RenderJob {
  return {
    id: row.id,
    candidateId: row.candidateId,
    status: row.status,
    outputPath: row.outputPath,
    progressPct: row.progressPct,
    message: row.message,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublishJob(row: PublishJobRow): PublishJob {
  return {
    id: row.id,
    candidateId: row.candidateId,
    status: row.status,
    youtubeVideoId: row.youtubeVideoId,
    uploadSessionUrl: row.uploadSessionUrl,
    scheduledAt: row.scheduledAt,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReplaySession(row: ReplaySessionRow): ReplaySession {
  return {
    id: row.id,
    rpyPath: row.rpyPath?.trim() ? row.rpyPath : null,
    ibtPath: row.ibtPath,
    mediaPath: row.mediaPath,
    trackName: row.trackName,
    focusCarIdx: row.focusCarIdx,
    title: row.title,
    durationSec: row.durationSec,
    status: row.status,
    events: row.events,
    racePackage: row.racePackage ?? null,
    raceAnalysis: row.raceAnalysis ?? null,
    fullVideoEncodePath: row.fullVideoEncodePath ?? null,
    fullVideoYoutubeId: row.fullVideoYoutubeId ?? null,
    fullVideoPrivacy: row.fullVideoPrivacy ?? null,
    fullVideoPublishedAt: row.fullVideoPublishedAt ?? null,
    fullVoiceOvers: row.fullVoiceOvers ?? null,
    deliveryAssets: row.deliveryAssets ?? null,
    publishManualChecklist: row.publishManualChecklist ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleChannelRepository implements ChannelRepository {
  constructor(private readonly db: AppDb) {}

  async save(channel: Channel): Promise<void> {
    await this.db
      .insert(channels)
      .values({
        id: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        title: channel.title,
        connectedAt: channel.connectedAt,
      })
      .onConflictDoUpdate({
        target: channels.id,
        set: {
          youtubeChannelId: channel.youtubeChannelId,
          title: channel.title,
          connectedAt: channel.connectedAt,
        },
      });
  }

  async getById(id: string): Promise<Channel | null> {
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);
    return rows[0] ? toChannel(rows[0]) : null;
  }

  async getByYoutubeChannelId(
    youtubeChannelId: string,
  ): Promise<Channel | null> {
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.youtubeChannelId, youtubeChannelId))
      .limit(1);
    return rows[0] ? toChannel(rows[0]) : null;
  }

  async list(): Promise<Channel[]> {
    const rows = await this.db.select().from(channels);
    return rows.map(toChannel);
  }
}

export class DrizzleSourceVideoRepository implements SourceVideoRepository {
  constructor(private readonly db: AppDb) {}

  async save(video: SourceVideo): Promise<void> {
    await this.db
      .insert(sourceVideos)
      .values({
        id: video.id,
        channelId: video.channelId,
        youtubeVideoId: video.youtubeVideoId,
        title: video.title,
        durationSec: video.durationSec,
        localMediaPath: video.localMediaPath,
        analyticsSnapshot: video.analyticsSnapshot,
        publishedAt: video.publishedAt,
        syncedAt: video.syncedAt,
      })
      .onConflictDoUpdate({
        target: sourceVideos.id,
        set: {
          channelId: video.channelId,
          youtubeVideoId: video.youtubeVideoId,
          title: video.title,
          durationSec: video.durationSec,
          localMediaPath: video.localMediaPath,
          analyticsSnapshot: video.analyticsSnapshot,
          publishedAt: video.publishedAt,
          syncedAt: video.syncedAt,
        },
      });
  }

  async getById(id: string): Promise<SourceVideo | null> {
    const rows = await this.db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.id, id))
      .limit(1);
    return rows[0] ? toSourceVideo(rows[0]) : null;
  }

  async getByYoutubeVideoId(
    youtubeVideoId: string,
  ): Promise<SourceVideo | null> {
    const rows = await this.db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.youtubeVideoId, youtubeVideoId))
      .limit(1);
    return rows[0] ? toSourceVideo(rows[0]) : null;
  }

  async listByChannelId(channelId: string): Promise<SourceVideo[]> {
    const rows = await this.db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.channelId, channelId));
    return rows.map(toSourceVideo);
  }

  async upsertMany(videos: SourceVideo[]): Promise<void> {
    if (videos.length === 0) {
      return;
    }

    await this.db
      .insert(sourceVideos)
      .values(
        videos.map((video) => ({
          id: video.id,
          channelId: video.channelId,
          youtubeVideoId: video.youtubeVideoId,
          title: video.title,
          durationSec: video.durationSec,
          localMediaPath: video.localMediaPath,
          analyticsSnapshot: video.analyticsSnapshot,
          publishedAt: video.publishedAt,
          syncedAt: video.syncedAt,
        })),
      )
      .onConflictDoUpdate({
        target: sourceVideos.id,
        set: {
          channelId: sql`excluded.channel_id`,
          youtubeVideoId: sql`excluded.youtube_video_id`,
          title: sql`excluded.title`,
          durationSec: sql`excluded.duration_sec`,
          localMediaPath: sql`excluded.local_media_path`,
          analyticsSnapshot: sql`excluded.analytics_snapshot`,
          publishedAt: sql`excluded.published_at`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }
}

export class DrizzleGenerationBriefRepository
  implements GenerationBriefRepository
{
  constructor(private readonly db: AppDb) {}

  async save(brief: GenerationBrief): Promise<void> {
    await this.db
      .insert(generationBriefs)
      .values({
        id: brief.id,
        channelId: brief.channelId,
        hook: brief.hook,
        script: brief.script,
        voiceProfile: brief.voiceProfile,
        brollPlan: brief.brollPlan,
        createdAt: brief.createdAt,
      })
      .onConflictDoUpdate({
        target: generationBriefs.id,
        set: {
          channelId: brief.channelId,
          hook: brief.hook,
          script: brief.script,
          voiceProfile: brief.voiceProfile,
          brollPlan: brief.brollPlan,
          createdAt: brief.createdAt,
        },
      });
  }

  async getById(id: string): Promise<GenerationBrief | null> {
    const rows = await this.db
      .select()
      .from(generationBriefs)
      .where(eq(generationBriefs.id, id))
      .limit(1);
    return rows[0] ? toGenerationBrief(rows[0]) : null;
  }

  async listByChannelId(channelId: string): Promise<GenerationBrief[]> {
    const rows = await this.db
      .select()
      .from(generationBriefs)
      .where(eq(generationBriefs.channelId, channelId));
    return rows.map(toGenerationBrief);
  }
}

export class DrizzleCandidateRepository implements CandidateRepository {
  constructor(private readonly db: AppDb) {}

  async save(candidate: ShortCandidate): Promise<void> {
    await this.db
      .insert(shortCandidates)
      .values({
        id: candidate.id,
        origin: candidate.origin,
        status: candidate.status,
        title: candidate.title,
        description: candidate.description,
        tags: candidate.tags,
        score: candidate.score,
        provenance: candidate.provenance,
        renderOutputPath: candidate.renderOutputPath,
        voiceOvers: candidate.voiceOvers ?? null,
        scheduledAt: candidate.scheduledAt,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      })
      .onConflictDoUpdate({
        target: shortCandidates.id,
        set: {
          origin: candidate.origin,
          status: candidate.status,
          title: candidate.title,
          description: candidate.description,
          tags: candidate.tags,
          score: candidate.score,
          provenance: candidate.provenance,
          renderOutputPath: candidate.renderOutputPath,
          voiceOvers: candidate.voiceOvers ?? null,
          scheduledAt: candidate.scheduledAt,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        },
      });
  }

  async getById(id: string): Promise<ShortCandidate | null> {
    const rows = await this.db
      .select()
      .from(shortCandidates)
      .where(eq(shortCandidates.id, id))
      .limit(1);
    return rows[0] ? toShortCandidate(rows[0]) : null;
  }

  async listByIds(ids: string[]): Promise<ShortCandidate[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids)];
    const rows = await this.db
      .select()
      .from(shortCandidates)
      .where(inArray(shortCandidates.id, uniqueIds));
    return rows.map(toShortCandidate);
  }

  async list(filter: {
    status?: string;
    origin?: string;
  }): Promise<ShortCandidate[]> {
    const conditions = [];
    if (filter.status) {
      conditions.push(eq(shortCandidates.status, filter.status as ShortCandidate["status"]));
    }
    if (filter.origin) {
      conditions.push(eq(shortCandidates.origin, filter.origin as ShortCandidate["origin"]));
    }

    const rows =
      conditions.length === 0
        ? await this.db.select().from(shortCandidates)
        : await this.db
            .select()
            .from(shortCandidates)
            .where(and(...conditions));

    return rows.map(toShortCandidate);
  }
}

export class DrizzleJobRepository implements JobRepository {
  constructor(private readonly db: AppDb) {}

  async saveRenderJob(job: RenderJob): Promise<void> {
    await this.db
      .insert(renderJobs)
      .values({
        id: job.id,
        candidateId: job.candidateId,
        status: job.status,
        outputPath: job.outputPath,
        progressPct: job.progressPct,
        message: job.message,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })
      .onConflictDoUpdate({
        target: renderJobs.id,
        set: {
          candidateId: job.candidateId,
          status: job.status,
          outputPath: job.outputPath,
          progressPct: job.progressPct,
          message: job.message,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
  }

  async savePublishJob(job: PublishJob): Promise<void> {
    await this.db
      .insert(publishJobs)
      .values({
        id: job.id,
        candidateId: job.candidateId,
        status: job.status,
        youtubeVideoId: job.youtubeVideoId,
        uploadSessionUrl: job.uploadSessionUrl,
        scheduledAt: job.scheduledAt,
        publishedAt: job.publishedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })
      .onConflictDoUpdate({
        target: publishJobs.id,
        set: {
          candidateId: job.candidateId,
          status: job.status,
          youtubeVideoId: job.youtubeVideoId,
          uploadSessionUrl: job.uploadSessionUrl,
          scheduledAt: job.scheduledAt,
          publishedAt: job.publishedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
  }

  async getRenderJobById(id: string): Promise<RenderJob | null> {
    const rows = await this.db
      .select()
      .from(renderJobs)
      .where(eq(renderJobs.id, id))
      .limit(1);
    return rows[0] ? toRenderJob(rows[0]) : null;
  }

  async getPublishJobById(id: string): Promise<PublishJob | null> {
    const rows = await this.db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, id))
      .limit(1);
    return rows[0] ? toPublishJob(rows[0]) : null;
  }

  async getRenderJobByCandidateId(
    candidateId: string,
  ): Promise<RenderJob | null> {
    const rows = await this.db
      .select()
      .from(renderJobs)
      .where(eq(renderJobs.candidateId, candidateId))
      .limit(1);
    return rows[0] ? toRenderJob(rows[0]) : null;
  }

  async getPublishJobByCandidateId(
    candidateId: string,
  ): Promise<PublishJob | null> {
    const rows = await this.db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.candidateId, candidateId))
      .limit(1);
    return rows[0] ? toPublishJob(rows[0]) : null;
  }

  async listPublishJobsByCandidateIds(
    candidateIds: string[],
  ): Promise<PublishJob[]> {
    if (candidateIds.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(candidateIds)];
    const rows = await this.db
      .select()
      .from(publishJobs)
      .where(inArray(publishJobs.candidateId, uniqueIds));
    return rows.map(toPublishJob);
  }
}

export class DrizzleReplaySessionRepository implements ReplaySessionRepository {
  constructor(private readonly db: AppDb) {}

  async save(session: ReplaySession): Promise<void> {
    await this.db
      .insert(replaySessions)
      .values({
        id: session.id,
        rpyPath: session.rpyPath ?? "",
        ibtPath: session.ibtPath,
        mediaPath: session.mediaPath,
        trackName: session.trackName,
        focusCarIdx: session.focusCarIdx,
        title: session.title,
        durationSec: session.durationSec,
        status: session.status,
        events: session.events,
        racePackage: session.racePackage,
        raceAnalysis: session.raceAnalysis ?? null,
        fullVideoEncodePath: session.fullVideoEncodePath,
        fullVideoYoutubeId: session.fullVideoYoutubeId,
        fullVideoPrivacy: session.fullVideoPrivacy,
        fullVideoPublishedAt: session.fullVideoPublishedAt,
        fullVoiceOvers: session.fullVoiceOvers ?? null,
        deliveryAssets: session.deliveryAssets ?? null,
        publishManualChecklist: session.publishManualChecklist ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })
      .onConflictDoUpdate({
        target: replaySessions.id,
        set: {
          rpyPath: session.rpyPath ?? "",
          ibtPath: session.ibtPath,
          mediaPath: session.mediaPath,
          trackName: session.trackName,
          focusCarIdx: session.focusCarIdx,
          title: session.title,
          durationSec: session.durationSec,
          status: session.status,
          events: session.events,
          racePackage: session.racePackage,
          raceAnalysis: session.raceAnalysis ?? null,
          fullVideoEncodePath: session.fullVideoEncodePath,
          fullVideoYoutubeId: session.fullVideoYoutubeId,
          fullVideoPrivacy: session.fullVideoPrivacy,
          fullVideoPublishedAt: session.fullVideoPublishedAt,
          fullVoiceOvers: session.fullVoiceOvers ?? null,
          deliveryAssets: session.deliveryAssets ?? null,
          publishManualChecklist: session.publishManualChecklist ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      });
  }

  async getById(id: string): Promise<ReplaySession | null> {
    const rows = await this.db
      .select()
      .from(replaySessions)
      .where(eq(replaySessions.id, id))
      .limit(1);
    return rows[0] ? toReplaySession(rows[0]) : null;
  }

  async list(): Promise<ReplaySession[]> {
    const rows = await this.db.select().from(replaySessions);
    return rows.map(toReplaySession);
  }
}

export type DbRepositories = {
  channels: DrizzleChannelRepository;
  sourceVideos: DrizzleSourceVideoRepository;
  generationBriefs: DrizzleGenerationBriefRepository;
  candidates: DrizzleCandidateRepository;
  jobs: DrizzleJobRepository;
  replaySessions: DrizzleReplaySessionRepository;
};

export function createRepositories(db: AppDb): DbRepositories {
  return {
    channels: new DrizzleChannelRepository(db),
    sourceVideos: new DrizzleSourceVideoRepository(db),
    generationBriefs: new DrizzleGenerationBriefRepository(db),
    candidates: new DrizzleCandidateRepository(db),
    jobs: new DrizzleJobRepository(db),
    replaySessions: new DrizzleReplaySessionRepository(db),
  };
}
