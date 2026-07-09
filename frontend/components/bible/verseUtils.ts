// Helpers for working with api.bible-style chapter content, where each verse is
// marked as "[n] text" (include-verse-numbers=true). Used to derive a single
// verse or a verse range on the client without extra network requests.

export interface ParsedVerse {
  num: string;
  text: string;
}

// Verse selection: null = whole chapter; otherwise inclusive verse range.
export interface VerseSelection {
  start: number;
  end: number;
}

// Split chapter content into ordered verses by their [n] markers.
export function parseVerses(content: string): ParsedVerse[] {
  const regex = /\[(\d+)\]\s*/g;
  const marks: { num: string; start: number; textStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    marks.push({ num: m[1], start: m.index, textStart: regex.lastIndex });
  }
  return marks.map((cur, i) => {
    const next = marks[i + 1];
    const text = content.slice(cur.textStart, next ? next.start : undefined).trim();
    return { num: cur.num, text };
  });
}

// Ordered verse numbers present in the chapter (for the verse grid).
export function verseNumbersOf(content: string): string[] {
  return parseVerses(content).map((v) => v.num);
}

// Rebuild "[n] text" content for the selected verse range, or the whole chapter
// when selection is null.
export function renderSelection(content: string, selection: VerseSelection | null): string {
  if (!selection) return content;
  const { start, end } = selection;
  return parseVerses(content)
    .filter((v) => {
      const n = Number(v.num);
      return n >= start && n <= end;
    })
    .map((v) => `[${v.num}] ${v.text}`)
    .join(' ');
}

// Common English book abbreviations -> USFM book IDs, for reference search.
// Covers conventional short forms that plain prefix-matching misses (jn, mk, dt...).
const BOOK_ALIASES: Record<string, string> = {
  gen: 'GEN', ge: 'GEN', gn: 'GEN',
  ex: 'EXO', exo: 'EXO', exod: 'EXO',
  lev: 'LEV', lv: 'LEV',
  num: 'NUM', nm: 'NUM', nu: 'NUM',
  deut: 'DEU', deu: 'DEU', dt: 'DEU',
  josh: 'JOS', jos: 'JOS',
  judg: 'JDG', jdg: 'JDG', jgs: 'JDG',
  ruth: 'RUT', rut: 'RUT', ru: 'RUT',
  '1sam': '1SA', '1sa': '1SA', '2sam': '2SA', '2sa': '2SA',
  '1kgs': '1KI', '1ki': '1KI', '2kgs': '2KI', '2ki': '2KI',
  '1chr': '1CH', '1ch': '1CH', '2chr': '2CH', '2ch': '2CH',
  ezra: 'EZR', ezr: 'EZR',
  neh: 'NEH', ne: 'NEH',
  est: 'EST', esth: 'EST',
  job: 'JOB', jb: 'JOB',
  ps: 'PSA', pss: 'PSA', psa: 'PSA', psalm: 'PSA', psalms: 'PSA',
  prov: 'PRO', pro: 'PRO', pr: 'PRO', prv: 'PRO',
  eccl: 'ECC', ecc: 'ECC', ec: 'ECC', qoh: 'ECC',
  song: 'SNG', sos: 'SNG', ss: 'SNG', sng: 'SNG', cant: 'SNG',
  isa: 'ISA', is: 'ISA',
  jer: 'JER', je: 'JER',
  lam: 'LAM', la: 'LAM',
  ezek: 'EZK', ezk: 'EZK', eze: 'EZK',
  dan: 'DAN', dn: 'DAN',
  hos: 'HOS', ho: 'HOS',
  joel: 'JOL', jol: 'JOL', jl: 'JOL',
  amos: 'AMO', amo: 'AMO', am: 'AMO',
  obad: 'OBA', oba: 'OBA', ob: 'OBA',
  jon: 'JON', jnh: 'JON',
  mic: 'MIC', mi: 'MIC',
  nah: 'NAM', nam: 'NAM', na: 'NAM',
  hab: 'HAB', hb: 'HAB',
  zeph: 'ZEP', zep: 'ZEP', zp: 'ZEP',
  hag: 'HAG', hg: 'HAG',
  zech: 'ZEC', zec: 'ZEC', zc: 'ZEC',
  mal: 'MAL', ml: 'MAL',
  matt: 'MAT', mat: 'MAT', mt: 'MAT',
  mark: 'MRK', mrk: 'MRK', mk: 'MRK', mr: 'MRK',
  luke: 'LUK', luk: 'LUK', lk: 'LUK', lu: 'LUK',
  john: 'JHN', jhn: 'JHN', jn: 'JHN',
  acts: 'ACT', act: 'ACT', ac: 'ACT',
  rom: 'ROM', ro: 'ROM', rm: 'ROM',
  '1cor': '1CO', '1co': '1CO', '2cor': '2CO', '2co': '2CO',
  gal: 'GAL', ga: 'GAL',
  eph: 'EPH', ep: 'EPH',
  phil: 'PHP', php: 'PHP', pp: 'PHP',
  col: 'COL',
  '1thess': '1TH', '1thes': '1TH', '1th': '1TH',
  '2thess': '2TH', '2thes': '2TH', '2th': '2TH',
  '1tim': '1TI', '1ti': '1TI', '2tim': '2TI', '2ti': '2TI',
  tit: 'TIT', ti: 'TIT',
  phlm: 'PHM', phm: 'PHM', philem: 'PHM',
  heb: 'HEB', he: 'HEB',
  jas: 'JAS', jam: 'JAS', jm: 'JAS',
  '1pet': '1PE', '1pe': '1PE', '1pt': '1PE',
  '2pet': '2PE', '2pe': '2PE', '2pt': '2PE',
  '1john': '1JN', '1jn': '1JN', '1jo': '1JN',
  '2john': '2JN', '2jn': '2JN', '2jo': '2JN',
  '3john': '3JN', '3jn': '3JN', '3jo': '3JN',
  jude: 'JUD', jud: 'JUD',
  rev: 'REV', re: 'REV', rv: 'REV', apoc: 'REV',
};

// Resolve a typed book query (e.g. "jn", "1 cor", "ps") to a USFM book ID,
// or null when no conventional abbreviation matches.
export function resolveBookAlias(query: string): string | null {
  const key = query.toLowerCase().replace(/[\s.]/g, '');
  return BOOK_ALIASES[key] || null;
}

// Append a verse selection to a translation-provided chapter reference, e.g.
// "John 3" + {16,16} -> "John 3:16"; "യോഹന്നാൻ 3" + {1,5} -> "യോഹന്നാൻ 3:1-5".
// Using the backend's reference keeps book names localized per translation.
export function referenceString(
  chapterReference: string,
  selection: VerseSelection | null
): string {
  if (!selection) return chapterReference;
  if (selection.start === selection.end) {
    return `${chapterReference}:${selection.start}`;
  }
  return `${chapterReference}:${selection.start}-${selection.end}`;
}
