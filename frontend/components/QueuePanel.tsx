'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { queueApi, QueueItem, Song } from '@/lib/api';
import { MusicIcon, PlayIcon, XIcon, ClipboardIcon, CheckIcon } from '@/components/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface QueuePanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onSongSelect?: (song: Song) => void;
  onSendToLive?: (song: Song) => void;
  onQueueChange?: () => void;
  refreshToken?: number;
}

interface SortableItemProps {
  item: QueueItem;
  index: number;
  onDelete: (id: number) => void;
  onSelect?: (song: Song) => void;
  onSendToLive?: (song: Song) => void;
}

function SortableItem({ item, index, onDelete, onSelect, onSendToLive }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-2 py-2.5 bg-surface-sunken rounded-lg border border-edge hover:border-edge-strong hover:bg-surface-hover transition-colors duration-150 ${
        isDragging ? 'z-50' : ''
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="shrink-0 p-1 cursor-grab active:cursor-grabbing text-ink-mute hover:text-ink-dim"
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </div>

      <span className="shrink-0 w-5 text-center text-xs text-ink-mute tabular-nums">
        {index + 1}
      </span>

      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onSelect && item.song && onSelect(item.song)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && item.song && onSelect) {
            e.preventDefault();
            onSelect(item.song);
          }
        }}
        title="Click to preview"
      >
        <div className="text-sm font-medium text-ink truncate group-hover:text-accent-hover transition-colors duration-150">
          {item.song?.title || 'Unknown'}
        </div>
        <div className="text-xs text-ink-mute truncate capitalize">
          {item.song?.language}
        </div>
      </div>

      <div className="flex gap-1 shrink-0">
        {onSendToLive && item.song && (
          <button
            onClick={() => onSendToLive(item.song!)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-ink-mute hover:text-ok hover:bg-ok/15 cursor-pointer transition-colors duration-150"
            aria-label={`Send ${item.song.title} to live`}
            title="Send to live"
          >
            <PlayIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(item.id)}
          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-mute hover:text-danger hover:bg-danger/10 cursor-pointer transition-colors duration-150"
          aria-label="Remove from queue"
          title="Remove from queue"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function QueuePanel({ isOpen, onToggle, onSongSelect, onSendToLive, onQueueChange, refreshToken }: QueuePanelProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchQueue = useCallback(async () => {
    try {
      setError(null);
      const items = await queueApi.getAll();
      setQueue(items);
      if (onQueueChange) {
        onQueueChange();
      }
    } catch (err) {
      console.error('Failed to fetch queue:', err);
      setError('Failed to load queue');
    }
  }, [onQueueChange]);

  // Initial fetch
  useEffect(() => {
    if (isOpen) {
      fetchQueue();
    }
  }, [isOpen, fetchQueue]);

  // Re-fetch when an external refresh is requested (e.g. a song was added)
  useEffect(() => {
    if (isOpen && refreshToken !== undefined) {
      fetchQueue();
    }
  }, [refreshToken, isOpen, fetchQueue]);

  // Poll every 5 seconds
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [isOpen, fetchQueue]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = queue.findIndex((item) => item.id === active.id);
    const newIndex = queue.findIndex((item) => item.id === over.id);

    const newQueue = arrayMove(queue, oldIndex, newIndex);
    setQueue(newQueue);

    try {
      const items = newQueue.map((item, index) => ({
        id: item.id,
        position: index,
      }));
      await queueApi.reorder(items);
      if (onQueueChange) {
        onQueueChange();
      }
    } catch (err) {
      console.error('Failed to reorder queue:', err);
      setError('Failed to reorder queue');
      fetchQueue(); // Revert on error
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setError(null);
      await queueApi.remove(id);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to remove from queue:', err);
      setError('Failed to remove item');
    }
  };

  const handleClearAll = async () => {
    try {
      setLoading(true);
      setError(null);
      await queueApi.clear();
      await fetchQueue();
      setConfirmClear(false);
    } catch (err) {
      console.error('Failed to clear queue:', err);
      setError('Failed to clear queue');
    } finally {
      setLoading(false);
    }
  };

  const handleSongSelect = (song: Song) => {
    if (onSongSelect) {
      onSongSelect(song);
    }
  };

  // Copy the setlist (queued song titles, one per line) so it can be pasted
  // into WhatsApp/notes for the team. Uses the queue already on screen.
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); }, []);

  const handleCopySetlist = async () => {
    const text = queue.map((i) => i.song?.title).filter(Boolean).join('\n');
    if (!text) {
      setError('The queue is empty — nothing to copy.');
      return;
    }
    try {
      setError(null);
      // The church LAN serves plain HTTP, where navigator.clipboard is
      // undefined, so fall back to execCommand on an off-screen textarea.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(el);
        }
      }
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy setlist:', err);
      setError("Couldn't copy the setlist. Try again.");
    }
  };

  return (
    <div className="h-full bg-surface-raised border border-edge rounded-xl overflow-hidden fade-swap">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-ink-mute uppercase tracking-wider">Queue</h2>
            {queue.length > 0 && (
              <span className="text-xs text-ink-dim bg-surface-sunken border border-edge px-2 py-0.5 rounded-full tabular-nums">
                {queue.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {copied && (
              <span className="text-xs font-medium text-ok fade-swap">Copied!</span>
            )}
            <button
              onClick={handleCopySetlist}
              disabled={queue.length === 0}
              className={`p-1.5 rounded-md cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                copied ? 'text-ok bg-ok/15' : 'text-ink-mute hover:text-ink hover:bg-surface-hover'
              }`}
              title="Copy the setlist (song titles) to the clipboard"
              aria-label="Copy setlist"
            >
              {copied ? <CheckIcon className="w-4 h-4" /> : <ClipboardIcon className="w-4 h-4" />}
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
              title="Close queue"
              aria-label="Close queue"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-4 mt-4 px-3 py-2 bg-danger/10 border border-danger/40 rounded-lg text-danger text-sm">
            {error}
          </div>
        )}

        {/* Queue items */}
        <div className="flex-1 overflow-y-auto p-3">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-12 h-12 mb-3 flex items-center justify-center rounded-full bg-surface-sunken border border-edge">
                <MusicIcon className="w-5 h-5 text-ink-mute" />
              </div>
              <p className="text-sm text-ink-dim font-medium">Queue is empty</p>
              <p className="text-xs mt-1 text-ink-mute">
                Use the add-to-queue button on a song to line it up for the service.
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={queue.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {queue.map((item, index) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      index={index}
                      onDelete={handleDelete}
                      onSelect={handleSongSelect}
                      onSendToLive={onSendToLive}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer */}
        {queue.length > 0 && (
          <div className="p-3 border-t border-edge">
            {confirmClear ? (
              <div className="space-y-2 fade-swap">
                <p className="text-sm text-ink-dim text-center">
                  Remove all {queue.length} {queue.length === 1 ? 'song' : 'songs'} from the queue?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleClearAll}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg bg-danger hover:bg-danger/85 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors duration-150"
                  >
                    {loading ? 'Clearing…' : 'Clear all'}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg border border-edge-strong text-ink-dim hover:text-ink hover:bg-surface-hover text-sm font-medium cursor-pointer transition-colors duration-150"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full px-4 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 text-sm font-medium cursor-pointer transition-colors duration-150"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
