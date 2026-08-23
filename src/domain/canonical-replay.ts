import fs from "node:fs";
import path from "node:path";

export type CanonicalReplayConfig = {
  sessionId: string;
  mediaPath: string;
  label: string;
  /** Human note only — never used as race metadata; HUD analysis owns track/facts. */
  notes?: string;
};

const CONFIG_RELATIVE = path.join("config", "canonical-replay.json");

let cached: CanonicalReplayConfig | null = null;

function repoRoot(): string {
  return path.resolve(process.cwd());
}

export function canonicalReplayConfigPath(root = repoRoot()): string {
  return path.join(root, CONFIG_RELATIVE);
}

export function loadCanonicalReplayConfig(
  root = repoRoot(),
): CanonicalReplayConfig {
  if (cached && root === repoRoot()) return cached;
  const configPath = canonicalReplayConfigPath(root);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as CanonicalReplayConfig;
  if (!raw.sessionId?.trim()) {
    throw new Error("canonical-replay.json: sessionId is required");
  }
  if (!raw.mediaPath?.trim()) {
    throw new Error("canonical-replay.json: mediaPath is required");
  }
  const config: CanonicalReplayConfig = {
    ...raw,
    sessionId: raw.sessionId.trim(),
    mediaPath: path.resolve(root, raw.mediaPath.trim()),
    label: raw.label?.trim() || "Canonical replay",
  };
  if (root === repoRoot()) cached = config;
  return config;
}

export function resolveCanonicalMediaPath(root = repoRoot()): string {
  const config = loadCanonicalReplayConfig(root);
  if (!fs.existsSync(config.mediaPath)) {
    throw new Error(`Canonical replay media not found: ${config.mediaPath}`);
  }
  return config.mediaPath;
}

export function pathsMatch(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
