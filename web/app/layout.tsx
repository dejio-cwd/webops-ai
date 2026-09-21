import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebOps AI — Evidence-driven website intelligence",
  description:
    "Crawl, audit, and fix websites with a deterministic rules engine, real Core Web Vitals, and evidence-grounded AI. Find → Explain → Prioritize → Fix → Verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
