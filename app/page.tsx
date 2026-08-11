import Link from "next/link";

import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const channels = await getContainer().repositories.channels.list();
  const connectedChannel = channels[0] ?? null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
        gap: "1.5rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.875rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ice-dim)",
        }}
      >
        S.Marcato 42 Racing
      </p>
      <h1
        style={{
          margin: 0,
          fontSize: "clamp(2rem, 5vw, 3rem)",
          fontWeight: 700,
          color: "var(--ice)",
        }}
      >
        YT Short Creator
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: "36rem",
          color: "var(--ice-dim)",
          fontSize: "1.125rem",
        }}
      >
        {connectedChannel
          ? `${connectedChannel.title} is connected and ready to sync.`
          : "Analyze your channel, propose branded Shorts from clips and generation, approve locally, and upload to YouTube."}
      </p>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link
          href={connectedChannel ? "/library" : "/connect"}
          style={{
            display: "inline-block",
            marginTop: "0.5rem",
            padding: "0.75rem 1.5rem",
            backgroundColor: "var(--rosso)",
            color: "var(--ice)",
            borderRadius: "4px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {connectedChannel ? "View library" : "Connect YouTube"}
        </Link>
        {connectedChannel ? (
          <Link
            href="/connect"
            style={{ alignSelf: "center", marginTop: "0.5rem" }}
          >
            Connection settings
          </Link>
        ) : null}
      </div>
    </main>
  );
}
