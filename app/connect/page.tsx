import Link from "next/link";

import { PageHeader } from "@/app/components/PageHeader";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

const YOUTUBE_OAUTH_MESSAGES: Record<string, string> = {
  state_mismatch:
    "OAuth state cookie missing (open Connect via http://localhost:3000, not 127.0.0.1).",
  invalid_callback: "YouTube OAuth callback was invalid. Try reconnecting.",
  connect_failed: "Connected to Google but channel sync failed. Try again.",
  start_failed: "Unable to start YouTube authorization. Check OAuth env config.",
};

const INSTAGRAM_OAUTH_MESSAGES: Record<string, string> = {
  state_mismatch:
    "Instagram OAuth state cookie missing (use the same host as META_REDIRECT_URI).",
  invalid_callback: "Instagram OAuth callback was invalid. Try reconnecting.",
  connect_failed:
    "Connected to Meta but Instagram account resolution failed. Ensure a Business/Creator IG is linked to a Facebook Page.",
  start_failed: "Unable to start Instagram authorization. Check META_* env config.",
  connected: "Instagram connected.",
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string; instagram?: string; username?: string }>;
}) {
  const container = getContainer();
  const channels = await container.repositories.channels.list();
  const channel = channels[0] ?? null;
  const instagramAccount = await container.repositories.instagramAccounts.get();
  const params = await searchParams;
  const youtubeOauthMessage = params.oauth
    ? (YOUTUBE_OAUTH_MESSAGES[params.oauth] ?? `YouTube OAuth error: ${params.oauth}`)
    : null;
  const instagramOauthMessage = params.instagram
    ? params.instagram === "connected"
      ? `Instagram connected as @${params.username ?? instagramAccount?.username ?? "account"}.`
      : (INSTAGRAM_OAUTH_MESSAGES[params.instagram] ??
        `Instagram OAuth error: ${params.instagram}`)
    : null;

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Accounts"
        title="Connect YouTube & Instagram"
        description="Authorize YouTube for Short uploads and Instagram for automatic Reels cross-post (Italian). Tokens stay on this machine."
      />

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>YouTube</h2>
          <p>
            {channel
              ? `Connected as ${channel.title}.`
              : "No channel connected yet."}
          </p>
          {youtubeOauthMessage ? (
            <p className="muted" role="alert">
              {youtubeOauthMessage}
            </p>
          ) : null}
        </div>
        <div className="home-cta-row">
          <a className="button button-primary" href="/api/auth/youtube">
            {channel ? "Reconnect YouTube" : "Connect YouTube"}
          </a>
          {channel ? (
            <Link className="button button-secondary" href="/library">
              Open library
            </Link>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Instagram Reels</h2>
          <p>
            {instagramAccount
              ? `Connected as @${instagramAccount.username} (Page: ${instagramAccount.pageName}). Approved Shorts publish as Italian Reels in parallel with YouTube.`
              : "Connect an Instagram Business or Creator account linked to a Facebook Page."}
          </p>
          {instagramOauthMessage ? (
            <p className="muted" role="alert">
              {instagramOauthMessage}
            </p>
          ) : null}
        </div>
        <div className="home-cta-row">
          <a className="button button-primary" href="/api/auth/instagram">
            {instagramAccount ? "Reconnect Instagram" : "Connect Instagram"}
          </a>
          {instagramAccount ? (
            <form action="/api/auth/instagram/disconnect" method="post">
              <button className="button button-ghost" type="submit">
                Disconnect Instagram
              </button>
            </form>
          ) : null}
        </div>
      </section>

      <div className="home-cta-row">
        <Link className="button button-ghost" href="/">
          Back home
        </Link>
      </div>
    </main>
  );
}
