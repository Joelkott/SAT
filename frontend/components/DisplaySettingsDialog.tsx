'use client';

import { useEffect, useState } from 'react';
import { displayConfigApi } from '@/lib/api';
import { XIcon } from '@/components/icons';

interface DisplaySettingsDialogProps {
  onClose: () => void;
}

export default function DisplaySettingsDialog({ onClose }: DisplaySettingsDialogProps) {
  const [spacing, setSpacing] = useState(1.6);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    displayConfigApi
      .get()
      .then((c) => { if (c.line_spacing) setSpacing(c.line_spacing); })
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

  const save = (value: number) => {
    setSpacing(value);
    setSaving(true);
    displayConfigApi.set({ line_spacing: value }).catch(() => {}).finally(() => setSaving(false));
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

        <div className="p-5 space-y-4">
          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-ink-dim">Lyrics line spacing</span>
              <span className="text-xs text-ink-mute tabular-nums">
                {saving ? 'Saving…' : `${spacing.toFixed(2)}×`}
              </span>
            </div>
            <input
              type="range"
              min={1.0}
              max={2.6}
              step={0.05}
              value={spacing}
              disabled={!loaded}
              onChange={(e) => save(Number(e.target.value))}
              className="w-full accent-accent cursor-pointer disabled:opacity-50"
            />
            <p className="text-xs text-ink-mute mt-1.5">
              Applies live to the display window, previews, and every other machine within
              a few seconds. Indic scripts automatically get a little extra room.
            </p>
          </label>
        </div>
      </div>
    </div>
  );
}
