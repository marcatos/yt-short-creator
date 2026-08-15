import type { Metadata } from "next";

import { AppShell } from "@/app/components/AppShell";
import { LAYOUT_DENSITY_BOOTSTRAP } from "@/app/lib/layout-density";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: LAYOUT_DENSITY_BOOTSTRAP }}
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
