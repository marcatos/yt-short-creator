import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}
