import Link from "next/link";

export default function HomePage() {
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
        Analyze your channel, propose branded Shorts from clips and generation,
        approve locally, and upload to YouTube.
      </p>
      <Link
        href="/candidates"
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
        View candidates
      </Link>
    </main>
  );
}
