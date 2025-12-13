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
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
