'use client';

import { useState, useEffect, useCallback } from 'react';
import { queueApi, QueueItem, Song } from '@/lib/api';
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
  onQueueChange?: () => void;
}

interface SortableItemProps {
  item: QueueItem;
  onDelete: (id: number) => void;
  onSelect?: (song: Song) => void;
}

function SortableItem({ item, onDelete, onSelect }: SortableItemProps) {
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
      className={`flex items-center gap-2 p-3 bg-[#141518] rounded border border-[#2a2c31] ${
        isDragging ? 'z-50 opacity-50' : ''
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-300"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 8h16M4 16h16"
          />
        </svg>
      </div>

      <div
        className="flex-1 min-w-0 cursor-pointer hover:text-blue-400 text-gray-200"
        onClick={() => onSelect && item.song && onSelect(item.song)}
      >
        <div className="font-medium truncate">{item.song?.title || 'Unknown'}</div>
        <div className="text-xs text-gray-400 truncate">
          {item.song?.language} • {item.song?.library}
        </div>
      </div>

      <button
        onClick={() => onDelete(item.id)}
        className="flex-shrink-0 p-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded"
        title="Remove from queue"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

export default function QueuePanel({ isOpen, onToggle, onSongSelect, onQueueChange }: QueuePanelProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!confirm('Clear all items from the queue?')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await queueApi.clear();
      await fetchQueue();
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

  return (
    <div
      className={`fixed top-0 left-0 h-full bg-[#1a1b1f] border-r border-[#2a2c31] shadow-lg transform transition-transform duration-300 ease-in-out z-40 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{ width: '300px' }}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a2c31]">
          <h2 className="text-lg font-semibold text-white">Queue</h2>
          <button
            onClick={onToggle}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#2a2c31] rounded transition-colors"
            title="Close queue"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-900/20 border border-red-800 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Queue items */}
        <div className="flex-1 overflow-y-auto p-4">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
              <svg
                className="w-16 h-16 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <p className="text-sm text-gray-400">No songs in queue</p>
              <p className="text-xs mt-1 text-gray-500">Add songs to get started</p>
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
                <div className="space-y-2">
                  {queue.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      onDelete={handleDelete}
                      onSelect={handleSongSelect}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer */}
        {queue.length > 0 && (
          <div className="p-4 border-t border-[#2a2c31]">
            <button
              onClick={handleClearAll}
              disabled={loading}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white rounded transition-colors"
            >
              {loading ? 'Clearing...' : 'Clear All'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
