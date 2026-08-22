'use client';

import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from '@/components/icons';

interface ReferenceSearchProps {
  onSearch: (reference: string) => void;
  isLoading: boolean;
}

const HISTORY_KEY = 'bible-search-history';
const HISTORY_MAX = 50;

export default function ReferenceSearch({
  onSearch,
  isLoading,
}: ReferenceSearchProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Shell-style history: ArrowUp recalls older searches, ArrowDown walks back
  // toward the draft the user was typing. Stored newest-first.
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1); // -1 = live draft, 0 = newest
  const draftRef = useRef('');

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(raw)) setHistory(raw.filter((s) => typeof s === 'string'));
    } catch {}
  }, []);

  // Keep the caret at the end after recalling a history entry.
  useEffect(() => {
    if (histIdx < 0) return;
    const el = inputRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, [histIdx, value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      const q = value.trim();
      onSearch(q);
      setHistory((prev) => {
        const next = [q, ...prev.filter((h) => h !== q)].slice(0, HISTORY_MAX);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      setHistIdx(-1);
      draftRef.current = '';
      setValue('');
    } else if (e.key === 'Escape') {
      setHistIdx(-1);
      draftRef.current = '';
      setValue('');
    } else if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      if (histIdx === -1) draftRef.current = value;
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setValue(history[next]);
    } else if (e.key === 'ArrowDown') {
      if (histIdx === -1) return;
      e.preventDefault();
      const next = histIdx - 1;
      setHistIdx(next);
      setValue(next === -1 ? draftRef.current : history[next]);
    }
  };

  return (
    <div className="relative">
      <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          // Editing a recalled entry turns it into the new draft.
          setValue(e.target.value);
          setHistIdx(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Go to reference — John 3:16, Psalm 23, Ps 112:2 NLT"
        disabled={isLoading}
        aria-label="Go to Bible reference"
        className="w-full h-10 bg-surface-input border border-edge hover:border-edge-strong focus:border-accent rounded-lg pl-10 pr-16 text-ink placeholder:text-ink-mute text-sm outline-none transition-colors duration-150 disabled:opacity-60"
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center h-5 px-1.5 rounded border border-edge bg-surface-sunken text-[10px] font-medium text-ink-mute pointer-events-none">
        Enter
      </kbd>
    </div>
  );
}
