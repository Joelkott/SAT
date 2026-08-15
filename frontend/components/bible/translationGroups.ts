import { BibleTranslation } from '@/lib/api';

// Ordering helper for the translation picker. With ~279 entries a flat list is
// unusable, so the ones this church actually uses come first, then English
// A-Z, then every other language grouped by name. Pure function, no React.

/** Curated order for the bundled/keyed translations we lead with. */
export const PINNED_IDS = [
  'local-kjv',
  'local-mal-ov',
  'local-ampc',
  'local-asv',
  'local-bbe',
  'local-mkjv',
  'local-ceb',
  'esv',
  'net',
];

export interface TranslationGroup {
  label: string;
  items: BibleTranslation[];
}

function abbr(t: BibleTranslation): string {
  return (t.abbreviationLocal || t.abbreviation || '').toLowerCase();
}

function byAbbr(a: BibleTranslation, b: BibleTranslation): number {
  return abbr(a).localeCompare(abbr(b));
}

function isEnglish(t: BibleTranslation): boolean {
  return t.language?.id === 'eng' || t.language?.name === 'English';
}

/**
 * Featured -> English -> one group per other language (A-Z) -> Other.
 * Never drops an entry: anything without a usable language lands in "Other".
 */
export function groupTranslations(list: BibleTranslation[]): TranslationGroup[] {
  const featured: BibleTranslation[] = [];
  const english: BibleTranslation[] = [];
  const byLanguage = new Map<string, BibleTranslation[]>();
  const other: BibleTranslation[] = [];

  for (const t of list) {
    if (PINNED_IDS.includes(t.id) || t.id?.startsWith('local-')) {
      featured.push(t);
    } else if (isEnglish(t)) {
      english.push(t);
    } else {
      const label = t.language?.name || t.language?.id;
      if (!label) {
        other.push(t);
        continue;
      }
      const bucket = byLanguage.get(label);
      if (bucket) bucket.push(t);
      else byLanguage.set(label, [t]);
    }
  }

  // Pinned order first; unknown local- ids keep their input order behind them.
  featured.sort((a, b) => {
    const ia = PINNED_IDS.indexOf(a.id);
    const ib = PINNED_IDS.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  english.sort(byAbbr);

  const groups: TranslationGroup[] = [];
  if (featured.length) groups.push({ label: 'Featured', items: featured });
  if (english.length) groups.push({ label: 'English', items: english });

  const languageLabels = Array.from(byLanguage.keys()).sort((a, b) => a.localeCompare(b));
  for (const label of languageLabels) {
    groups.push({ label, items: byLanguage.get(label)!.sort(byAbbr) });
  }
  if (other.length) groups.push({ label: 'Other', items: other });

  return groups;
}
