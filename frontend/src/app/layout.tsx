import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HH GOA 2026 — Biometric Face ID & Blockchain Verification",
  description:
    "Biometric 128D Face Identification, Web/Social Media Discovery & EVM Blockchain Verification Pipeline — HH Goa 2026 Task #3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        {/* Lexend is self-hosted from public/ and declared in globals.css.
            Preloading it here stops the display heading from reflowing once
            the variable font lands. */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/landing-pages/inner-green-assets/lexend-latin.woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
