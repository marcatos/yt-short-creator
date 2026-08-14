let chain: Promise<void> = Promise.resolve();

/**
 * Serialize all YouTube Studio browser automation (Inspiration scrape,
 * related-video, headed login) onto one persistent profile.
 */
export async function withStudioLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = chain;
  let release!: () => void;
  chain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
