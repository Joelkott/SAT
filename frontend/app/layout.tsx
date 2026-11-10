import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no request to Google from the browser). Used in
// --font-ui as the guaranteed Latin font before the generic fallback.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Audience Stage Teleprompter",
  description: "Ultra-low latency multilingual lyrics search and display system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" translate="no" className={inter.variable}>
      <head>
        <meta name="google" content="notranslate" />
        {/* Fetch the Devanagari font up front instead of on the first verse
            that needs it, so Hindi never flashes in a fallback font. */}
        <link rel="preload" href="/fonts/mangal.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
