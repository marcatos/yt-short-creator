export type LlmTextPart = {
  type: "text";
  text: string;
};

export type LlmImagePart = {
  type: "image";
  /** Absolute path to a local image file, or a data:/https: URL. */
  imagePathOrUrl: string;
};

export type LlmUserPart = LlmTextPart | LlmImagePart;

export type LlmCompleteInput = {
  system: string;
  /** Plain-text user message (used when `userParts` is omitted). */
  user: string;
  /** Multimodal user content; when set, takes precedence over `user`. */
  userParts?: LlmUserPart[];
  jsonSchema?: Record<string, unknown>;
};

export interface LlmPort {
  complete(input: LlmCompleteInput): Promise<string>;
}
