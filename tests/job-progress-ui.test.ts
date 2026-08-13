import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  JobProgress,
  jobActionsFor,
  normalizeJob,
  reorderJobIds,
  type JobView,
} from "@/app/components/JobProgress";

function job(id: string, status: string, position: number): JobView {
  return {
    id,
    type: "render",
    candidateId: null,
    title: null,
    previewUrl: null,
    status,
    position,
    checkpointStep: null,
    progressPct: 0,
    message: "",
    createdAt: "2026-08-11T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  };
}

describe("Jobs UI model", () => {
  it("normalizes progress payloads that use pct", () => {
    expect(
      normalizeJob({
        ...job("job-1", "running", 0),
        progressPct: undefined,
        pct: 42,
      }),
    ).toMatchObject({ id: "job-1", progressPct: 42 });
  });

  it.each([
    ["running", ["pause", "cancel"]],
    ["paused", ["resume", "cancel", "top", "bottom"]],
    ["queued", ["cancel", "top", "bottom"]],
    ["succeeded", []],
  ])("returns the expected controls for %s jobs", (status, actions) => {
    expect(jobActionsFor(status)).toEqual(actions);
  });

  it("moves a dragged controllable job before its drop target", () => {
    const jobs = [
      job("running", "running", 0),
      job("queued-1", "queued", 1),
      job("done", "succeeded", 2),
      job("paused", "paused", 3),
      job("queued-2", "queued", 4),
    ];

    expect(reorderJobIds(jobs, "queued-2", "queued-1")).toEqual([
      "queued-2",
      "queued-1",
      "paused",
    ]);
  });

  it("renders checkpoint context and state-specific controls", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const markup = renderToStaticMarkup(
      createElement(JobProgress, {
        initialJobs: [
          { ...job("running", "running", 0), checkpointStep: "render" },
          job("paused", "paused", 1),
          job("queued", "queued", 2),
        ],
      }),
    );

    expect(markup).toContain("running @ render");
    expect(markup).toContain(">pause<");
    expect(markup).toContain(">resume<");
    expect(markup).toContain(">top<");
    expect(markup).toContain(">bottom<");
  });
});
