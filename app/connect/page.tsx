import Link from "next/link";

import { PageHeader } from "@/app/components/PageHeader";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

const OAUTH_MESSAGES: Record<string, string> = {
  state_mismatch:
    "OAuth state cookie missing (open Connect via http://localhost:3000, not 127.0.0.1).",
  invalid_callback: "YouTube OAuth callback was invalid. Try reconnecting.",
  connect_failed: "Connected to Google but channel sync failed. Try again.",
  start_failed: "Unable to start YouTube authorization. Check OAuth env config.",
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string }>;
}) {
  const channels = await getContainer().repositories.channels.list();
  const channel = channels[0] ?? null;
  const params = await searchParams;
  const oauthMessage = params.oauth
    ? (OAUTH_MESSAGES[params.oauth] ?? `OAuth error: ${params.oauth}`)
    : null;

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="YouTube account"
        title="Connect your channel"
        description="Authorize read access to sync your upload catalog and upload access for publishing approved Shorts. Your OAuth tokens stay on this machine."
      />

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Connection status</h2>
          <p>
            {channel
              ? `Connected as ${channel.title}.`
              : "No channel connected yet."}
          </p>
          {oauthMessage ? (
            <p className="muted" role="alert">
              {oauthMessage}
            </p>
          ) : null}
        </div>
        <div className="home-cta-row">
          <a className="button button-primary" href="/api/auth/youtube">
            {channel ? "Reconnect YouTube" : "Connect YouTube"}
          </a>
          <Link className="button button-ghost" href="/">
            Back home
          </Link>
          {channel ? (
            <Link className="button button-secondary" href="/library">
              Open library
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
