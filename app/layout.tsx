import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "S.Marcato 42 Racing — YT Short Creator",
  description:
    "Analyze your YouTube channel, propose branded Shorts, approve, and upload.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand-lockup" href="/">
            <span className="brand-slash" aria-hidden="true" />
            <span>
              <strong>S.MARCATO 42</strong>
              <small>SHORT CONTROL</small>
            </span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/library">Library</Link>
            <Link href="/candidates">Candidates</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
