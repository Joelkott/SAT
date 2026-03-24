'use client';

import { BibleTranslation } from '@/lib/api';

interface TranslationSelectorProps {
  translations: BibleTranslation[];
  selectedId: string;
  onSelect: (bibleId: string) => void;
  isLoading: boolean;
}

export default function TranslationSelector({
  translations,
  selectedId,
  onSelect,
  isLoading,
}: TranslationSelectorProps) {
  return (
    <select
      value={selectedId}
      onChange={(e) => onSelect(e.target.value)}
      disabled={isLoading && translations.length === 0}
      className="w-full bg-[#16171b] border border-[#2a2c31] focus:border-[#3a3c42] focus:ring-1 focus:ring-[#3a3c42] text-gray-100 rounded-lg px-4 py-2 text-sm outline-none"
    >
      {isLoading && translations.length === 0 && (
        <option value="" disabled>
          Loading...
        </option>
      )}
      {!isLoading && translations.length === 0 && (
        <option value="" disabled>
          No Bible translations available. Check the API configuration.
        </option>
      )}
      {translations.map((t) => (
        <option key={t.id} value={t.id}>
          {t.abbreviationLocal || t.abbreviation} - {t.nameLocal || t.name}
        </option>
      ))}
    </select>
  );
}
