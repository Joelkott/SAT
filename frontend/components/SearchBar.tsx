'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchIcon, XIcon } from '@/components/icons';

interface SearchBarProps {
  onSearch: (query: string, languages: string[]) => void;
}

const LANGUAGES = [
  { code: 'english', label: 'English' },
  { code: 'malayalam', label: 'Malayalam' },
  { code: 'hindi', label: 'Hindi' },
  { code: 'tamil', label: 'Tamil' },
];

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box from anywhere (skipped while typing, and when
  // this tab is hidden — both tabs stay mounted).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      e.preventDefault();
      inputRef.current.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query, languages);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, languages, onSearch]);

  const toggleLanguage = (code: string) => {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by title, artist, or lyrics…  ( / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-10 pr-10 py-3 bg-surface-input text-ink rounded-lg border border-edge hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150"
          autoFocus
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setLanguages([]);
            }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {LANGUAGES.map((lang) => {
          const isActive = languages.includes(lang.code);
          return (
            <button
              key={lang.code}
              onClick={() => toggleLanguage(lang.code)}
              aria-pressed={isActive}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150 border ${
                isActive
                  ? 'bg-accent/15 border-accent/50 text-accent-hover'
                  : 'bg-surface-sunken border-edge text-ink-dim hover:border-edge-strong hover:text-ink'
              }`}
            >
              {lang.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
