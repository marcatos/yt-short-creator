import Link from "next/link";

import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const channels = await getContainer().repositories.channels.list();
  const channel = channels[0] ?? null;

  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "4rem 2rem" }}>
      <p
        style={{
          color: "var(--ice-dim)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        YouTube account
      </p>
      <h1>Connect your channel</h1>
      <p style={{ color: "var(--ice-dim)", maxWidth: "38rem" }}>
        Authorize read access to sync your upload catalog and upload access for
        publishing approved Shorts. Your OAuth tokens stay on this machine.
      </p>
      {channel ? (
        <p>
          Connected as <strong>{channel.title}</strong>
        </p>
      ) : null}
      <a
        href="/api/auth/youtube"
        style={{
          display: "inline-block",
          marginTop: "1rem",
          padding: "0.75rem 1.25rem",
          borderRadius: "4px",
          background: "var(--rosso)",
          color: "var(--ice)",
          fontWeight: 700,
        }}
      >
        {channel ? "Reconnect YouTube" : "Connect YouTube"}
      </a>
      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Back home</Link>
        {channel ? (
          <>
            {" · "}
            <Link href="/library">Open library</Link>
          </>
        ) : null}
      </p>
    </main>
  );
}
