"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type JobState = {
  status: string;
  progressPct: number;
  message: string;
};

const wait = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export function GenerateIdeasButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateIdeas(): Promise<void> {
    setError(null);
    setJob({ status: "queued", progressPct: 0, message: "Queueing ideation" });
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, count: 3 }),
      });
      if (!response.ok) throw new Error("Could not queue Shorts ideation");
      const { jobId } = (await response.json()) as { jobId: string };
      const deadline = Date.now() + 5 * 60_000;

      while (Date.now() < deadline) {
        const progressResponse = await fetch(
          `/api/generate?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        if (!progressResponse.ok) throw new Error("Could not read job progress");
        const nextJob = (await progressResponse.json()) as JobState;
        setJob(nextJob);
        if (nextJob.status === "succeeded") {
          router.refresh();
          return;
        }
        if (nextJob.status === "failed" || nextJob.status === "cancelled") {
          throw new Error(nextJob.message || "Shorts ideation failed");
        }
        await wait(800);
      }
      throw new Error("Shorts ideation timed out after 5 minutes");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Shorts ideation failed";
      setJob((current) =>
        current ? { ...current, status: "failed", message } : null,
      );
      setError(message);
    }
  }

  const running = job !== null && !["succeeded", "failed", "cancelled"].includes(job.status);
  return (
    <div className="library-generate">
      <button
        className="button button-secondary"
        type="button"
        onClick={generateIdeas}
        disabled={running}
      >
        {running ? "Generating…" : "Generate Shorts ideas"}
      </button>
      {job ? (
        <p aria-live="polite" className="muted library-generate-status">
          {job.progressPct}% — {job.message}
        </p>
      ) : null}
      {error ? (
        <p className="job-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
