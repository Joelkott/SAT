import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" translate="no">
      <head>
        <meta name="google" content="notranslate" />
        {/* Fetch the Indic fonts up front instead of on the first verse that
            needs them, so Malayalam/Hindi never flash in a fallback font. */}
        <link rel="preload" href="/fonts/MAL-Anjali.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/mangal.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
