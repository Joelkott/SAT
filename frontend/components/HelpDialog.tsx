'use client';

import { useEffect } from 'react';
import { XIcon } from '@/components/icons';

interface HelpDialogProps {
  onClose: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-sunken border border-edge-strong text-ink text-[11px] font-semibold font-mono whitespace-nowrap">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <span className="text-sm text-ink-dim">{children}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-mute text-xs">/</span>}
            <Kbd>{k}</Kbd>
          </span>
        ))}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-2">{title}</h3>
      <div className="bg-surface-sunken/50 border border-edge rounded-lg divide-y divide-edge">
        {children}
      </div>
    </div>
  );
}

export default function HelpDialog({ onClose }: HelpDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-2xl my-6 fade-swap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-lg font-semibold text-ink">How to use SAT</h2>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section title="Getting a song on screen">
            <div className="px-3 py-2 text-sm text-ink-dim">
              Search for a song, then <span className="text-ink">click it</span> to load it into the{' '}
              <span className="text-ink">PREVIEW</span> box. When you&apos;re ready, press the{' '}
              <span className="text-ok">play</span> button on the preview (or the song row) to send it
              to the live display. The <span className="text-live">LIVE</span> monitor mirrors what the
              congregation sees.
            </div>
          </Section>

          <Section title="Queue">
            <div className="px-3 py-2 text-sm text-ink-dim">
              Use the <span className="text-ink">add-to-queue</span> button on a song row to line up
              songs for the service, and the <span className="text-ink">Queue</span> button next to
              search to show the panel. Drag rows to reorder. Clicking a queued song loads it into
              preview; its play button sends it straight to live.
            </div>
            <ShortcutRow keys={['1', '…', '9']}>Load queue position 1–9 into preview</ShortcutRow>
          </Section>

          <Section title="Control window shortcuts">
            <ShortcutRow keys={['/']}>Jump to the song search box</ShortcutRow>
            <ShortcutRow keys={['Ctrl+Shift+L', '⌘+Shift+L']}>Send the previewed song to live</ShortcutRow>
            <div className="px-3 py-2 text-sm text-ink-dim">
              The <span className="text-ink">pencil</span> on the preview box edits lyrics inline —
              saving updates the song, and the live display if that song is live. Drag the divider
              between LIVE and PREVIEW (or between list and panels) to resize.
            </div>
          </Section>

          <Section title="Bible tab">
            <ShortcutRow keys={['←', '→']}>Step to the previous / next verse (flows across chapters)</ShortcutRow>
            <div className="px-3 py-2 text-sm text-ink-dim">
              Your last five passages appear as chips under the toolbar. Use{' '}
              <span className="text-ink">Pin</span> in the actions row to keep a passage there
              permanently — handy for the sermon&apos;s key verses.
            </div>
          </Section>

          <Section title="Display window shortcuts">
            <ShortcutRow keys={['F', 'F11']}>Toggle fullscreen</ShortcutRow>
            <ShortcutRow keys={['+', '-']}>Zoom lyrics in / out</ShortcutRow>
            <ShortcutRow keys={['0']}>Reset zoom</ShortcutRow>
            <ShortcutRow keys={['L', 'C', 'R']}>Align text left / center / right</ShortcutRow>
            <ShortcutRow keys={['S', ';']}>Add / remove a split pane</ShortcutRow>
          </Section>
        </div>
      </div>
    </div>
  );
}
