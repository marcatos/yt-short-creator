import type { GenerationBrief } from "@/src/domain/entities";

export interface GenerationBriefRepository {
  save(brief: GenerationBrief): Promise<void>;
  getById(id: string): Promise<GenerationBrief | null>;
  listByChannelId(channelId: string): Promise<GenerationBrief[]>;
}
