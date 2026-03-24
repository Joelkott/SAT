'use client';

import { useState } from 'react';

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
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="e.g., John 3:16 or Gen 1:1-5"
      disabled={isLoading}
      className="w-full bg-[#16171b] border border-[#2a2c31] focus:ring-1 focus:ring-[#3a3c42] focus:border-[#3a3c42] rounded-lg px-4 py-3 text-gray-100 placeholder:text-gray-500 text-sm outline-none"
    />
  );
}
