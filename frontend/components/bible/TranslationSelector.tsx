'use client';

import { BibleTranslation } from '@/lib/api';
import { ChevronDownIcon } from '@/components/icons';

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
    <div className="relative">
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        disabled={isLoading && translations.length === 0}
        aria-label="Choose translation"
        className="w-full h-9 appearance-none bg-surface-input border border-edge hover:border-edge-strong focus:border-accent text-ink font-medium rounded-lg pl-3 pr-8 text-sm outline-none cursor-pointer transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
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
            {t.abbreviationLocal || t.abbreviation} — {t.nameLocal || t.name}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
    </div>
  );
}
