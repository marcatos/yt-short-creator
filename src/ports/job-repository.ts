import type { PublishJob, RenderJob, InstagramPublishJob } from "@/src/domain/entities";

export interface JobRepository {
  saveRenderJob(job: RenderJob): Promise<void>;
  savePublishJob(job: PublishJob): Promise<void>;
  saveInstagramPublishJob(job: InstagramPublishJob): Promise<void>;
  getRenderJobById(id: string): Promise<RenderJob | null>;
  getPublishJobById(id: string): Promise<PublishJob | null>;
  getInstagramPublishJobById(id: string): Promise<InstagramPublishJob | null>;
  getRenderJobByCandidateId(
    candidateId: string,
  ): Promise<RenderJob | null>;
  getPublishJobByCandidateId(
    candidateId: string,
  ): Promise<PublishJob | null>;
  getInstagramPublishJobByCandidateId(
    candidateId: string,
  ): Promise<InstagramPublishJob | null>;
  listPublishJobsByCandidateIds(
    candidateIds: string[],
  ): Promise<PublishJob[]>;
  listInstagramPublishJobsByCandidateIds(
    candidateIds: string[],
  ): Promise<InstagramPublishJob[]>;
}
