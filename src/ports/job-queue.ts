export interface JobQueuePort {
  enqueue(job: {
    type: string;
    payload: Record<string, unknown>;
  }): Promise<string>;
  getProgress(
    jobId: string,
  ): Promise<{ pct: number; message: string } | null>;
}
