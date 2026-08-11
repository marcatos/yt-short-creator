export interface MediaDurationPort {
  probeDurationSec(mediaPath: string): Promise<number | null>;
}
