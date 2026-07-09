'use client';

import { useState } from 'react';
import { SearchIcon } from '@/components/icons';

interface ReferenceSearchProps {
  onSearch: (reference: string) => void;
  isLoading: boolean;
}

export default function ReferenceSearch({
  onSearch,
  isLoading,
}: ReferenceSearchProps) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      onSearch(value.trim());
      setValue('');
    } else if (e.key === 'Escape') {
      setValue('');
    }
  };

  return (
    <div className="relative">
      <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Go to reference — John 3:16, Psalm 23, Gen 1:1-5"
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
