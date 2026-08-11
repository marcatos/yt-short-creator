export type LlmCompleteInput = {
  system: string;
  user: string;
  jsonSchema?: Record<string, unknown>;
};

export interface LlmPort {
  complete(input: LlmCompleteInput): Promise<string>;
}
