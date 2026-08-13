import { describe, expect, it } from "vitest";

import { createPackageShortDeliveryAssets } from "@/src/application/package-short-delivery-assets";
import type { ShortCandidate } from "@/src/domain/entities";
import type { VoiceOverPackage } from "@/src/domain/voice-over";
import type { Logger } from "@/src/ports/logger";
import type { MediaStorePort } from "@/src/ports/media-store";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function logger(): Logger {
  const instance: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => instance,
  };
  return instance;
}

describe("packageShortDeliveryAssets Case A/B", () => {
  it("packages a language-neutral Case A short", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "short-delivery-"));
    const master = path.join(root, "master.mp4");
    await fs.writeFile(master, "fake-video");
    const mediaStore: MediaStorePort = {
      sourcePath: () => "",
      renderPath: (id) => path.join(root, "renders", `${id}.mp4`),
      audioPath: () => "",
      brollPath: () => "",
      replayAnalysisDir: () => "",
      fullReplayEncodePath: () => "",
      listBroll: async () => [],
      ensureDirs: async () => undefined,
      async writeText(filePath, content) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      },
    };

    const candidate: ShortCandidate = {
      id: "cand-1",
      origin: "replay",
      status: "proposed",
      title: "Switchback",
      description: "desc",
      tags: ["Shorts"],
      score: 0.9,
      provenance: {
        replaySessionId: "s1",
        startMs: 0,
        endMs: 20_000,
        hookReason: "hook",
        eventType: "llm_moment",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
      renderOutputPath: master,
      scheduledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const vos: VoiceOverPackage[] = [
      {
        language: "it",
        script: "it",
        title: "Titolo IT",
        description: "Desc IT",
        voiceProfile: "ash",
        audioPath: path.join(root, "vo-it.mp3"),
        words: [],
        srtPath: path.join(root, "vo-it.srt"),
        assPath: null,
        scriptHash: "h1",
      },
      {
        language: "en",
        script: "en",
        title: "Title EN",
        description: "Desc EN",
        voiceProfile: "coral",
        audioPath: path.join(root, "vo-en.mp3"),
        words: [],
        srtPath: path.join(root, "vo-en.srt"),
        assPath: null,
        scriptHash: "h2",
      },
    ];
    await fs.writeFile(vos[0]!.srtPath!, "1\n");
    await fs.writeFile(vos[1]!.srtPath!, "1\n");

    const pack = createPackageShortDeliveryAssets({ mediaStore, logger: logger() });
    const bundle = await pack({
      candidate,
      masterVideoPath: master,
      voiceOvers: vos,
      requiresLocalizedRender: false,
    });

    expect(bundle.metadata.requiresLocalizedRender).toBe(false);
    expect(bundle.masterVideoPath).toContain("short_master.mp4");
    expect(bundle.metadata.localizations.it.title).toBe("Titolo IT");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("flags Case B localized renders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "short-delivery-b-"));
    const master = path.join(root, "master.mp4");
    const shortIt = path.join(root, "it.mp4");
    const shortEn = path.join(root, "en.mp4");
    await fs.writeFile(master, "m");
    await fs.writeFile(shortIt, "it");
    await fs.writeFile(shortEn, "en");
    const mediaStore: MediaStorePort = {
      sourcePath: () => "",
      renderPath: (id) => path.join(root, "renders", `${id}.mp4`),
      audioPath: () => "",
      brollPath: () => "",
      replayAnalysisDir: () => "",
      fullReplayEncodePath: () => "",
      listBroll: async () => [],
      ensureDirs: async () => undefined,
      async writeText(filePath, content) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      },
    };
    const candidate: ShortCandidate = {
      id: "cand-b",
      origin: "replay",
      status: "proposed",
      title: "Localized",
      description: "d",
      tags: [],
      score: 1,
      provenance: {
        replaySessionId: "s1",
        startMs: 0,
        endMs: 15_000,
        hookReason: "hook",
        eventType: "llm_moment",
        crop: { mode: "center_vertical", focusX: 0.5 },
      },
      renderOutputPath: master,
      scheduledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const vos: VoiceOverPackage[] = [
      {
        language: "it",
        script: "it",
        title: "IT",
        description: "IT",
        voiceProfile: "ash",
        audioPath: path.join(root, "a-it.mp3"),
        words: [],
        srtPath: null,
        assPath: null,
        scriptHash: "a",
      },
      {
        language: "en",
        script: "en",
        title: "EN",
        description: "EN",
        voiceProfile: "coral",
        audioPath: path.join(root, "a-en.mp3"),
        words: [],
        srtPath: null,
        assPath: null,
        scriptHash: "b",
      },
    ];
    const pack = createPackageShortDeliveryAssets({ mediaStore, logger: logger() });
    const bundle = await pack({
      candidate,
      masterVideoPath: master,
      voiceOvers: vos,
      requiresLocalizedRender: true,
      shortItPath: shortIt,
      shortEnPath: shortEn,
    });
    expect(bundle.metadata.requiresLocalizedRender).toBe(true);
    expect(bundle.masterVideoPath).toBeNull();
    await expect(
      fs.access(path.join(root, "renders", "cand-b", "delivery", "short_it.mp4")),
    ).resolves.toBeUndefined();
    await fs.rm(root, { recursive: true, force: true });
  });
});
