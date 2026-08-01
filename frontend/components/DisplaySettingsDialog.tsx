'use client';

import { useEffect, useState } from 'react';
import { displayConfigApi } from '@/lib/api';
import { XIcon } from '@/components/icons';

interface DisplaySettingsDialogProps {
  onClose: () => void;
}

export default function DisplaySettingsDialog({ onClose }: DisplaySettingsDialogProps) {
  const [line, setLine] = useState(1.6);
  const [para, setPara] = useState(1.0);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    displayConfigApi
      .get()
      .then((c) => {
        if (c.line_spacing) setLine(c.line_spacing);
        if (c.paragraph_spacing !== undefined) setPara(c.paragraph_spacing);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (next: { line?: number; para?: number }) => {
    const l = next.line ?? line;
    const p = next.para ?? para;
    setLine(l);
    setPara(p);
    setSaving(true);
    displayConfigApi
      .set({ line_spacing: l, paragraph_spacing: p })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-md fade-swap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div>
            <h2 className="text-lg font-semibold text-ink">Display settings</h2>
            <p className="text-xs text-ink-mute mt-0.5">Applies to every device, not just this one</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close display settings"
            className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-ink-dim">Line spacing</span>
              <span className="text-xs text-ink-mute tabular-nums">{line.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={0.8}
              max={2.6}
              step={0.05}
              value={line}
              disabled={!loaded}
              onChange={(e) => save({ line: Number(e.target.value) })}
              className="w-full accent-accent cursor-pointer disabled:opacity-50"
            />
            <p className="text-xs text-ink-mute mt-1.5">
              Gap between lines within a verse. 1.0× means lines just touch — go below
              only if you need to squeeze a long song in.
            </p>
          </label>

          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-ink-dim">Paragraph spacing</span>
              <span className="text-xs text-ink-mute tabular-nums">
                {para === 0 ? 'none' : `${para.toFixed(2)}×`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={para}
              disabled={!loaded}
              onChange={(e) => save({ para: Number(e.target.value) })}
              className="w-full accent-accent cursor-pointer disabled:opacity-50"
            />
            <p className="text-xs text-ink-mute mt-1.5">
              Gap between verses/chorus blocks. 0 runs sections together; 0.5× is half a
              line, like Word&apos;s paragraph spacing.
            </p>
          </label>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-ink-mute">
              {saving ? 'Saving…' : 'Applies to every device within a few seconds'}
            </span>
            <button
              onClick={() => save({ line: 1.6, para: 1.0 })}
              className="text-xs text-ink-mute hover:text-ink cursor-pointer transition-colors duration-150"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
