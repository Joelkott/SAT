import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'SAT Viewer' };

// Phone-first: real device width, draw under the notch (safe-area padding in the page), black browser chrome.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
