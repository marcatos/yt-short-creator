const MAX_CAPTION_LENGTH = 2200;

export type ReelCaptionInput = {
  title: string;
  description: string;
  youtubeChannelUrl: string;
  hashtags: string[];
};

function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || /shorts/i.test(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(`#${tag}`);
    if (result.length >= 8) break;
  }
  return result;
}

function trimDescription(description: string): string {
  const lines = description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/(^|\s)#shorts\b/i.test(line));
  return lines.slice(0, 2).join("\n");
}

export function assembleReelCaption(input: ReelCaptionInput): string {
  const title = input.title.trim();
  const description = trimDescription(input.description);
  const channelUrl = input.youtubeChannelUrl.trim();
  const hashtags = normalizeHashtags(input.hashtags);

  const parts: string[] = [];
  if (title) parts.push(title);
  if (description && description !== title) parts.push(description);
  parts.push("");
  parts.push(`Short completi su YouTube → ${channelUrl}`);
  if (hashtags.length > 0) {
    parts.push("");
    parts.push(hashtags.join(" "));
  }

  let caption = parts.join("\n").trim();
  if (caption.length > MAX_CAPTION_LENGTH) {
    caption = `${caption.slice(0, MAX_CAPTION_LENGTH - 1)}…`;
  }
  return caption;
}
