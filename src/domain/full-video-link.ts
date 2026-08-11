/**
 * Build a short YouTube URL for a video id.
 */
export function youtubeWatchUrl(youtubeVideoId: string): string {
  return `https://youtu.be/${youtubeVideoId}`;
}

/**
 * Append a full-video link to a Short description when missing.
 * Idempotent if the id or common URL forms are already present.
 */
export function withFullVideoLink(
  description: string,
  youtubeVideoId: string,
): string {
  const id = youtubeVideoId.trim();
  if (!id) {
    return description;
  }

  const url = youtubeWatchUrl(id);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const existing = description.toLowerCase();
  if (
    existing.includes(id.toLowerCase()) ||
    existing.includes(url.toLowerCase()) ||
    existing.includes(watchUrl.toLowerCase())
  ) {
    return description;
  }

  const base = description.trim();
  return base ? `${base}\n\nFull video: ${url}` : `Full video: ${url}`;
}
