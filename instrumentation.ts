/**
 * Next.js instrumentation hook.
 *
 * Intentionally does NOT import the app container or start job workers.
 * Heavy FFmpeg/YouTube jobs run in a dedicated process (`npm run workers`)
 * so localhost stays responsive. Importing `@/src/lib/container` here pulled
 * `googleapis` into the instrumentation graph and broke/hung Next.
 */
export async function register() {
  // no-op
}
