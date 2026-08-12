import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoogleYouTubeCaptions } from "@/src/adapters/youtube/youtube-captions";
import type { Logger } from "@/src/ports/logger";

const tempDirs: string[] = [];

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

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("Google YouTube captions adapter", () => {
  it("uploads an SRT track with the requested video and language metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-captions-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "vo-it.srt");
    await fs.writeFile(
      filePath,
      "1\n00:00:00,000 --> 00:00:01,000\nCiao!\n",
      "utf8",
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "caption-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const captions = createGoogleYouTubeCaptions({ logger: logger() });
    await expect(
      captions.upload({
        accessToken: "secret-access-token",
        youtubeVideoId: "youtube-it",
        filePath,
        language: "it",
        name: "VO",
      }),
    ).resolves.toEqual({ youtubeCaptionId: "caption-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret-access-token",
    });
    expect((init.headers as Record<string, string>)["Content-Type"]).toMatch(
      /^multipart\/related; boundary=/,
    );
    const body = String(init.body);
    expect(body).toContain('"videoId":"youtube-it"');
    expect(body).toContain('"language":"it"');
    expect(body).toContain('"name":"VO"');
    expect(body).toContain("Content-Type: application/x-subrip");
    expect(body).toContain("Ciao!");
  });

  it("surfaces the YouTube response when caption upload fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-captions-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "vo-en.srt");
    await fs.writeFile(filePath, "captions", "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("caption permission denied", { status: 403 }),
      ),
    );

    const captions = createGoogleYouTubeCaptions({ logger: logger() });
    await expect(
      captions.upload({
        accessToken: "secret-access-token",
        youtubeVideoId: "youtube-en",
        filePath,
        language: "en",
        name: "VO",
      }),
    ).rejects.toThrow(/403.*caption permission denied/i);
  });
});
