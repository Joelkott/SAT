'use client';

import { useState } from 'react';
import { queueApi, QueueItem } from '@/lib/api';

interface QueueSheetProps {
  open: boolean;
  onClose: () => void;
  queue: QueueItem[];
  currentLiveId?: string;
  readOnly: boolean;
  onPick: (item: QueueItem) => void;
  onChanged: () => void;
}

// Bottom sheet listing the service queue. Tapping a row browses that song on
// the phone only. Remove buttons are shown to non-guest roles (readOnly=false).
export default function QueueSheet({ open, onClose, queue, currentLiveId, readOnly, onPick, onChanged }: QueueSheetProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleRemove = async (item: QueueItem) => {
    if (readOnly) return;
    setError('');
    setBusyId(item.id);
    try {
      await queueApi.remove(item.id);
      onChanged();
    } catch (err: any) {
      console.error('Error removing queue item:', err);
      setError(err?.response?.data?.error || 'Could not remove — try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface-raised border-t border-edge"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 h-12 bg-surface-raised border-b border-edge">
          <span className="font-semibold">Queue</span>
          <button type="button" onClick={onClose} className="min-h-12 px-3 text-sm text-ink-dim hover:text-ink cursor-pointer">
            Close
          </button>
        </div>
        {error && <p className="px-4 py-2 text-sm text-danger">{error}</p>}
        {queue.length === 0 ? (
          <p className="px-4 py-8 text-center text-ink-mute">The queue is empty</p>
        ) : (
          <ul>
            {queue.map((item, i) => {
              const isLive = !!currentLiveId && item.song_id === currentLiveId;
              return (
                <li key={item.id} className="flex items-center gap-2 border-b border-edge last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { onPick(item); onClose(); }}
                    className="flex-1 min-w-0 min-h-12 flex items-center gap-3 px-4 py-2 text-left cursor-pointer hover:bg-surface-hover"
                  >
                    <span className="w-6 text-right text-sm text-ink-mute tabular-nums">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate">{item.song?.title || item.song_id}</span>
                    {isLive && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-live text-white">LIVE</span>
                    )}
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleRemove(item)}
                      className="min-h-12 px-4 text-sm text-danger cursor-pointer disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
