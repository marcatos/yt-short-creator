export type JobHandlerContext = {
  jobId: string;
  payload: Record<string, unknown>;
  setProgress(pct: number, message: string): void;
};

export type JobHandler = (ctx: JobHandlerContext) => Promise<void>;

export type JobHandlers = Record<string, JobHandler>;

const stub = (label: string): JobHandler => async (ctx) => {
  ctx.setProgress(0, `${label} started`);
  ctx.setProgress(100, `${label} complete`);
};

export function createStubHandlers(): JobHandlers {
  return {
    sync_channel: stub("Channel sync"),
    analyze_clips: stub("Clip analysis"),
    ideate: stub("Ideation"),
    assemble_generate_preview: stub("Generate preview"),
    render_short: stub("Render"),
    publish_short: stub("Publish"),
  };
}
