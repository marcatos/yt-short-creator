import Link from "next/link";

import { PageHeader } from "@/app/components/PageHeader";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const channels = await getContainer().repositories.channels.list();
  const channel = channels[0] ?? null;

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
