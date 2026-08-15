'use client';

import { useMemo } from 'react';
import { BibleTranslation } from '@/lib/api';
import { ChevronDownIcon } from '@/components/icons';
import { groupTranslations } from '@/components/bible/translationGroups';

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
  // ~279 entries: group them so the list is navigable (grouping is pure, so
  // memoising on the array reference is enough).
  const groups = useMemo(() => groupTranslations(translations), [translations]);

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
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abbreviationLocal || t.abbreviation} — {t.nameLocal || t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDownIcon className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
    </div>
  );
}
