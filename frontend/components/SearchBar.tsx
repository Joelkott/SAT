'use client';

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

interface SearchBarProps {
  onSearch: (query: string, languages: string[]) => void;
}

export interface SearchBarRef {
  focus: () => void;
}

const LANGUAGES = [
  { code: 'english', label: 'English' },
  { code: 'malayalam', label: 'Malayalam' },
  { code: 'hindi', label: 'Hindi' },
];

const SearchBar = forwardRef<SearchBarRef, SearchBarProps>(function SearchBarComponent({ onSearch }, ref) {
  const [query, setQuery] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }), []);

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
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by title, artist, or lyrics..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-4 py-3 bg-[#16171b] text-gray-100 rounded-lg border border-[#2a2c31] focus:ring-2 focus:ring-[#3a3c42] focus:border-[#3a3c42] placeholder-gray-500"
          autoFocus
        />
      </div>

      <div className="flex gap-2">
        {LANGUAGES.map((lang) => {
          const isActive = languages.includes(lang.code);
          return (
            <button
              key={lang.code}
              onClick={() => toggleLanguage(lang.code)}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                isActive
                  ? 'bg-[#2c2d32] border-[#3a3c42] text-gray-100'
                  : 'bg-[#141518] border-[#24262c] text-gray-300 hover:border-[#3a3c42]'
              }`}
            >
              {lang.label}
            </button>
          );
        })}
      </div>

      {query && (
        <button
          onClick={() => {
            setQuery('');
            setLanguages([]);
          }}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Clear search
        </button>
      )}
    </div>
  );
});

SearchBar.displayName = 'SearchBar';

export default SearchBar;
