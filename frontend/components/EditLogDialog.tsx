'use client';

import { useEffect, useState } from 'react';
import { adminApi, EditLog } from '@/lib/api';
import { XIcon, ChevronDownIcon } from '@/components/icons';

interface EditLogDialogProps {
  onClose: () => void;
}

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-ok/15 text-ok border-ok/40',
  update: 'bg-accent/15 text-accent-hover border-accent/40',
  delete: 'bg-danger/10 text-danger border-danger/40',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  library: 'Library',
  language: 'Language',
  display_lyrics: 'Display lyrics',
  music_ministry_lyrics: 'Music ministry lyrics',
  artist: 'Artist',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function LogRow({ log }: { log: EditLog }) {
  const [open, setOpen] = useState(false);
  const changedFields = log.changes ? Object.keys(log.changes) : [];
  const expandable = changedFields.length > 0;

  return (
    <div className="border-b border-edge last:border-b-0">
      <div
        className={`flex items-center gap-3 px-4 py-2.5 ${expandable ? 'cursor-pointer hover:bg-surface-hover/60' : ''}`}
        onClick={() => expandable && setOpen((v) => !v)}
      >
        <span className="shrink-0 w-28 text-xs text-ink-mute tabular-nums">{formatTime(log.created_at)}</span>
        <span className="shrink-0 w-20 text-sm text-ink-dim capitalize truncate" title={log.username}>
          {log.username}
        </span>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize ${
            ACTION_STYLES[log.action] || 'bg-surface-sunken text-ink-dim border-edge'
          }`}
        >
          {log.action}
        </span>
        <span className="flex-1 min-w-0 text-sm text-ink truncate" title={log.song_title}>
          {log.song_title}
        </span>
        {expandable && (
          <span className="shrink-0 flex items-center gap-1.5 text-xs text-ink-mute">
            {changedFields.map((f) => FIELD_LABELS[f] || f).join(', ')}
            <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </span>
        )}
      </div>

      {open && log.changes && (
        <div className="px-4 pb-3 space-y-3">
          {Object.entries(log.changes).map(([field, change]) => (
            <div key={field}>
              <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-1.5">
                {FIELD_LABELS[field] || field}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <pre className="whitespace-pre-wrap font-sans text-xs text-ink-dim bg-danger/5 border border-danger/20 rounded-lg p-2.5 max-h-48 overflow-y-auto">
                  {change.old || <span className="text-ink-mute italic">empty</span>}
                </pre>
                <pre className="whitespace-pre-wrap font-sans text-xs text-ink bg-ok/5 border border-ok/20 rounded-lg p-2.5 max-h-48 overflow-y-auto">
                  {change.new || <span className="text-ink-mute italic">empty</span>}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EditLogDialog({ onClose }: EditLogDialogProps) {
  const [logs, setLogs] = useState<EditLog[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi
      .getEditLogs()
      .then(setLogs)
      .catch((err) => {
        console.error('Failed to load edit logs:', err);
        setError('Failed to load edit history');
      });
  }, []);

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
        className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-3xl my-6 fade-swap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div>
            <h2 className="text-lg font-semibold text-ink">Edit history</h2>
            <p className="text-xs text-ink-mute mt-0.5">Song changes by all team accounts, newest first</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close edit history"
            className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {error ? (
            <div className="m-4 px-3 py-2 bg-danger/10 border border-danger/40 rounded-lg text-danger text-sm">
              {error}
            </div>
          ) : logs === null ? (
            <p className="p-6 text-sm text-ink-mute text-center">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="p-6 text-sm text-ink-mute text-center">
              No edits recorded yet. Changes made from now on will appear here.
            </p>
          ) : (
            logs.map((log) => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </div>
    </div>
  );
}
