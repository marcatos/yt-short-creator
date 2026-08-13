import type { PublishJob, RenderJob } from "@/src/domain/entities";

export interface JobRepository {
  saveRenderJob(job: RenderJob): Promise<void>;
  savePublishJob(job: PublishJob): Promise<void>;
  getRenderJobById(id: string): Promise<RenderJob | null>;
  getPublishJobById(id: string): Promise<PublishJob | null>;
  getRenderJobByCandidateId(
    candidateId: string,
  ): Promise<RenderJob | null>;
  getPublishJobByCandidateId(
    candidateId: string,
  ): Promise<PublishJob | null>;
  listPublishJobsByCandidateIds(
    candidateIds: string[],
  ): Promise<PublishJob[]>;
}
