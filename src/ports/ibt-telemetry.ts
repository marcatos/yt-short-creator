import type { ReplayEvent } from "@/src/domain/entities";

export type IbtParseResult = {
  events: ReplayEvent[];
  trackName: string | null;
};

export interface IbtTelemetryPort {
  parse(ibtPath: string): Promise<IbtParseResult>;
}
