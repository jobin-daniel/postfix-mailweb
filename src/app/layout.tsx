import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getAppConfig } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "mail-log-viewer | Postfix Mail Log Inspector",
  description:
    "Read-only searchable web UI for inspecting Postfix mail logs, delivery attempts, bounces, and live mail flow.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = getAppConfig();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell logSource={config.logSource}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
