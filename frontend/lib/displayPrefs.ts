// Shared display preferences (text alignment + font family) used by the
// control window's quick-edit toolbar, the settings dialog and the display
// window. Everything here reuses the storage keys and BroadcastChannel message
// types that already exist — nothing new is invented.

export type TextAlign = 'left' | 'center' | 'right';

/** Read by app/display/page.tsx and SongFullScreen. */
export const ALIGN_KEY = 'lyrics-text-align';
/** Written today by SettingsDialog. */
export const FONT_KEY = 'display-font-family';

export const DEFAULT_ALIGN: TextAlign = 'center';
export const DEFAULT_FONT = 'system-ui';

/** Same list as SettingsDialog's font dropdown. */
export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'System Default', value: 'system-ui' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Comic Sans MS', value: "'Comic Sans MS', cursive" },
];

export function isTextAlign(v: unknown): v is TextAlign {
  return v === 'left' || v === 'center' || v === 'right';
}

// Every localStorage/BroadcastChannel touch is SSR-guarded: these helpers are
// imported by client components that Next.js still renders on the server.

export function readAlign(): TextAlign {
  if (typeof window === 'undefined') return DEFAULT_ALIGN;
  const saved = localStorage.getItem(ALIGN_KEY);
  return isTextAlign(saved) ? saved : DEFAULT_ALIGN;
}

export function readFontFamily(): string {
  if (typeof window === 'undefined') return DEFAULT_FONT;
  return localStorage.getItem(FONT_KEY) || DEFAULT_FONT;
}

export function setAlign(a: TextAlign, ch?: BroadcastChannel | null): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ALIGN_KEY, a);
  ch?.postMessage({ type: 'align', textAlign: a });
}

export function setFontFamily(f: string, ch?: BroadcastChannel | null): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FONT_KEY, f);
  ch?.postMessage({ type: 'displaySettings', fontFamily: f });
}
