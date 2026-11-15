import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const SITE_URL = process.env["SITE_URL"] ?? "https://zaynnnnnnn.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  openGraph: { type: "website", siteName: "why" },
  twitter: { card: "summary_large_image" },
  title: { default: "why: ask any line of code why it exists", template: "%s · why" },
  description:
    "why follows a line of code back through every commit, move and rename, and shows the pull requests, reviews and issues behind each change.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

const REPO_URL = "https://github.com/ZaYnnnnnnn/why";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-[96rem] items-center justify-between px-4">
            <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
              why<span className="text-accent">?</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted">
              <Link href="/express/" className="hover:text-fg">
                Express
              </Link>
              <Link href="/flask/" className="hover:text-fg">
                Flask
              </Link>
              <Link href="/react/" className="hover:text-fg">
                React
              </Link>
              <a href={REPO_URL} className="hover:text-fg">
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
