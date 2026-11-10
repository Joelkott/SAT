'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  bibleApi,
  liveApi,
  BibleTranslation,
  BibleBook,
  BibleChapter,
  OutputConfig,
  WallLayout,
  WallPreset,
} from '@/lib/api';
import TranslationSelector from '@/components/bible/TranslationSelector';
import BookList from '@/components/bible/BookList';
import ChapterGrid from '@/components/bible/ChapterGrid';
import VerseGrid from '@/components/bible/VerseGrid';
import VerseDisplay from '@/components/bible/VerseDisplay';
import ReferenceSearch from '@/components/bible/ReferenceSearch';
import {
  VerseSelection,
  verseNumbersOf,
  renderSelection,
  referenceString,
  resolveBookAlias,
} from '@/components/bible/verseUtils';
import { normalizeBibleIds } from '@/components/bible/translationGroups';
import { PlusIcon, XIcon, ChevronRightIcon, BookOpenIcon, PinIcon } from '@/components/icons';
import { getRole, isGuest } from '@/lib/role';
import useVerseDetect from '@/components/bible/useVerseDetect';
import VerseDetectToggle from '@/components/bible/VerseDetectToggle';
import VerseDetectBanner from '@/components/bible/VerseDetectBanner';

// Language ids whose scripts need taller line boxes (stacked conjuncts).
const INDIC_LANGS = new Set(['mal', 'hin', 'tam', 'tel', 'kan']);

const MAX_COLUMNS = 4;

// Built-in pins shown to every operator ahead of their own; they can't be unpinned.
const PERMANENT_PINS = [
  { label: "Lord's Table", ref: '1 Corinthians 11:23' },
];

// Per-column chapter payload; empty content marks "not available here".
interface ChapterData {
  content: string;
  reference: string;
}

// A send requested while the chapter was still loading, bound to the exact
// navigation it was made for. '*' chapter/selection = accept wherever an
// in-flight cross-boundary arrow step lands.
type PendingSend = {
  kind: 'wall' | 'display' | 'mirror';
  gen: number;
  chapterId: string;
  selKey: string;
  bibles?: string[];
  // Remote (phone) caller waiting on this send: told whether it really went out.
  settle?: (ok: boolean, message?: string) => void;
};

type SendOutcome = { ok: boolean; message?: string };

// Imperative API used by the paired-phone remote. Every send goes through the
// same pending-send queue as the operator's own actions.
export interface BiblePanelHandle {
  lookupAndSend(reference: string, target: 'auto' | 'wall' | 'display'): Promise<SendOutcome>;
  step(dir: 1 | -1, send: boolean): Promise<SendOutcome>;
  clear(): Promise<SendOutcome>;
}

// Longest a remote caller waits for a queued send to settle.
const SETTLE_CAP_MS = 4000;

const selKey = (s: VerseSelection | null) => (s ? `${s.start}-${s.end}` : 'all');

// Identity of what is on the wall: passage + columns, so re-sending the same
// verse in different translations still counts as a change.
const wallKey = (passage: string, bibles?: string[]) =>
  `${passage}|${normalizeBibleIds(bibles || []).join(',')}`;

type AutoMode = 'off' | 'all' | 'jev' | 'worship';
const AUTO_MODE_KEY = 'bible-auto-mode';
const AUTO_MODES: { value: AutoMode; label: string; title: string; mediaOnly?: boolean }[] = [
  { value: 'off', label: 'Confirm', title: 'Jev detections and worship verses wait for your confirmation' },
  { value: 'all', label: 'Auto: Jev + Worship', title: 'Jev detections and worship verses go to the wall immediately', mediaOnly: true },
  { value: 'jev', label: 'Auto: Jev', title: 'Jev detections go to the wall immediately; worship verses wait for confirmation' },
  { value: 'worship', label: 'Auto: Worship', title: 'Worship verses go to the wall immediately; Jev detections wait for confirmation', mediaOnly: true },
];

type WallCfg = { blur: number; box_w_px: number; box_h_px: number; text_scale: number; layout: WallLayout; fade_ms: number };

const toWallCfg = (c: OutputConfig): WallCfg => ({
  blur: c.blur,
  box_w_px: c.box_w_px,
  box_h_px: c.box_h_px,
  text_scale: c.text_scale,
  layout: c.layout === 'fullscreen' ? 'fullscreen' : 'imag',
  fade_ms: c.fade_ms ?? 600,
});

const sameWallCfg = (a: WallCfg, b: WallCfg) =>
  a.blur === b.blur &&
  a.box_w_px === b.box_w_px &&
  a.box_h_px === b.box_h_px &&
  a.text_scale === b.text_scale &&
  a.layout === b.layout &&
  a.fade_ms === b.fade_ms;

// Enter on a focused button/link should activate it, not send to the wall —
// except inside [data-enter-sends] (verse/chapter/pin navigation), where the
// operator clicks then presses Enter to send.
function isActivatableControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return !!el.closest('button, a, [role="button"]') && !el.closest('[data-enter-sends]');
}

function BiblePanel(_props: {}, ref: React.ForwardedRef<BiblePanelHandle>) {
  // Available translations + the ones currently shown as columns (max 4).
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [selectedBibleIds, setSelectedBibleIds] = useState<string[]>([]);

  // Shared navigation (book/chapter IDs are USFM-consistent across translations).
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [chapters, setChapters] = useState<BibleChapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<BibleChapter | null>(null);

  // Full chapter per translation: content ("[n] text ...") plus the
  // translation's own localized reference (e.g. "യോഹന്നാൻ 3" for MOV). The
  // displayed verse(s) are derived from content via `selection`, so isolating
  // a verse never refetches and never resets navigation.
  const [fullChapters, setFullChapters] = useState<Record<string, ChapterData>>({});
  const [selection, setSelection] = useState<VerseSelection | null>(null);

  const [isLoadingTranslations, setIsLoadingTranslations] = useState(true);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryBibleId = selectedBibleIds[0] || '';

  // Bumped on every operator navigation intent; a queued send only fires if
  // no navigation happened since it was requested.
  const navGenRef = useRef(0);
  // Generation of the reference lookup still awaiting its chapter list. It
  // only counts while it is the latest navigation, so a newer click ends it.
  const searchGenRef = useRef<number | null>(null);
  const isSearchInFlight = () =>
    searchGenRef.current !== null && searchGenRef.current === navGenRef.current;
  // Cross-boundary stepping: which verse/chapter to land on once data loads.
  const pendingVerseRef = useRef<'first' | 'last' | null>(null);
  const pendingChapterRef = useRef<'first' | 'last' | null>(null);

  // 1. On mount: fetch translations, default to KJV + MOV.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingTranslations(true);
        const data = await bibleApi.getBibles();
        if (cancelled) return;
        setTranslations(data);

        // Restore persisted columns if they still exist in the catalog.
        let initial: string[] = [];
        try {
          const saved = JSON.parse(localStorage.getItem('bible-columns') || '[]');
          if (Array.isArray(saved) && saved.length > 0) {
            initial = normalizeBibleIds(saved.filter((id: unknown) => typeof id === 'string'))
              .filter((id) => data.some((t) => t.id === id));
          }
        } catch {}

        if (initial.length === 0) {
          // Fall back to KJV + Malayalam OV defaults.
          const kjv = data.find((t) => t.id === 'local-kjv');
          const mov =
            data.find((t) => t.id === 'local-mal-ov') ||
            data.find((t) => t.language?.id === 'mal');
          initial = [kjv?.id, mov?.id].filter(Boolean) as string[];
          if (initial.length === 0 && data.length > 0) initial.push(data[0].id);
        }
        setSelectedBibleIds(initial);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading translations:', err);
        setError('No Bible translations available. Check the API configuration.');
      } finally {
        if (!cancelled) setIsLoadingTranslations(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the active translation columns so they survive page reload.
  useEffect(() => {
    if (selectedBibleIds.length > 0) {
      try { localStorage.setItem('bible-columns', JSON.stringify(selectedBibleIds)); } catch {}
    }
  }, [selectedBibleIds]);

  // 2. When the primary translation changes: fetch its books (drives nav labels).
  useEffect(() => {
    if (!primaryBibleId) return;
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingBooks(true);
        setError(null);
        const data = await bibleApi.getBooks(primaryBibleId);
        if (cancelled) return;
        setBooks(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading books:', err);
        setError('Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingBooks(false);
      }
    })();
    return () => { cancelled = true; };
  }, [primaryBibleId]);

  // 3. When a book is selected: fetch its chapter list. Does NOT reset the
  //    selected chapter — manual navigation handlers do that — so reference
  //    search can set book + chapter together without a race.
  useEffect(() => {
    if (!selectedBook || !primaryBibleId) return;
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingChapters(true);
        setError(null);
        const data = await bibleApi.getChapters(primaryBibleId, selectedBook.id);
        if (cancelled) return;
        setChapters(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading chapters:', err);
        setError('Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingChapters(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBook, primaryBibleId]);

  // Mirror of fullChapters + which chapter it belongs to, so the fetch effect
  // can read current contents without a self-triggering dependency.
  const fullChaptersRef = useRef<{ chapterId: string; map: Record<string, ChapterData> }>({
    chapterId: '',
    map: {},
  });

  // 4. When the chapter or the set of columns changes: fetch full chapters.
  //    Only missing translations are fetched — adding/removing a column never
  //    refetches (or blanks) the columns already loaded.
  useEffect(() => {
    if (!selectedChapter || selectedBibleIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const prev = fullChaptersRef.current;
      const have = prev.chapterId === selectedChapter.id ? prev.map : {};
      const missing = selectedBibleIds.filter((id) => have[id] === undefined);

      // Nothing to fetch (column removed/reordered): prune without network.
      if (missing.length === 0) {
        const pruned: Record<string, ChapterData> = {};
        selectedBibleIds.forEach((id) => { pruned[id] = have[id]; });
        fullChaptersRef.current = { chapterId: selectedChapter.id, map: pruned };
        setFullChapters(pruned);
        return;
      }

      const isNewChapter = Object.keys(have).length === 0;
      try {
        // Full-screen spinner only for a genuine chapter change; adding a
        // column keeps existing columns visible while the new one loads.
        setIsLoadingContent(isNewChapter);
        setError(null);
        // Fetch each column independently — a translation that lacks this
        // chapter (e.g. an NT-only Bible) must not blank the other columns.
        const entries = await Promise.all(
          missing.map(async (id) => {
            try {
              const data = await bibleApi.getChapter(id, selectedChapter.id);
              return [id, { content: data.content, reference: data.reference }] as const;
            } catch (err) {
              console.error(`Error loading chapter for ${id}:`, err);
              return [id, { content: '', reference: '' }] as const;
            }
          })
        );
        if (cancelled) return;
        const merged: Record<string, ChapterData> = {};
        selectedBibleIds.forEach((id) => {
          const fetched = entries.find(([eid]) => eid === id);
          merged[id] = fetched ? fetched[1] : have[id];
        });
        fullChaptersRef.current = { chapterId: selectedChapter.id, map: merged };
        setFullChapters(merged);
        // Only a failure of the primary column is treated as a load error.
        setError(merged[selectedBibleIds[0]]?.content ? null : 'Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingContent(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedChapter, selectedBibleIds]);

  // Column handlers ---------------------------------------------------------
  const handleChangeSlot = useCallback((index: number, bibleId: string) => {
    setSelectedBibleIds((prev) => prev.map((id, i) => (i === index ? bibleId : id)));
  }, []);

  const handleRemoveSlot = useCallback((index: number) => {
    setSelectedBibleIds((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const handleAddSlot = useCallback(() => {
    setSelectedBibleIds((prev) => {
      if (prev.length >= MAX_COLUMNS) return prev;
      // Prefer a reliable full-canon default (bundled KJV), then any unused.
      const unused =
        translations.find((t) => t.id === 'local-kjv' && !prev.includes(t.id)) ||
        translations.find((t) => !prev.includes(t.id));
      return unused ? [...prev, unused.id] : prev;
    });
  }, [translations]);

  // Navigation handlers -----------------------------------------------------
  const handleSelectBook = useCallback((book: BibleBook) => {
    navGenRef.current++;
    setSelectedBook(book);
    setSelectedChapter(null);
    setSelection(null);
    setFullChapters({});
  }, []);

  const handleSelectChapter = useCallback((chapter: BibleChapter) => {
    navGenRef.current++;
    setSelectedChapter(chapter);
    setSelection(null);
  }, []);

  const handleSelectVerse = useCallback((verseNumber: string) => {
    navGenRef.current++;
    const n = Number(verseNumber);
    setSelection({ start: n, end: n });
  }, []);

  const handleShowFullChapter = useCallback(() => {
    navGenRef.current++;
    setSelection(null);
  }, []);

  // Resolve a typed translation abbreviation ("nlt", "kjv", "mov") to a Bible
  // id. Several catalog entries can share an abbreviation, so prefer an exact
  // match, then the bundled local copies, then anything whose abbreviation
  // ends with the token (e.g. "engKJV" for "kjv").
  const findTranslationByAbbrev = useCallback((token: string): string | null => {
    const q = token.trim().toLowerCase();
    if (!q) return null;
    const score = (t: BibleTranslation) => {
      const a = (t.abbreviation || '').toLowerCase();
      const al = (t.abbreviationLocal || '').toLowerCase();
      if (a === q || al === q) return t.id.startsWith('local-') ? 0 : 1;
      // Edition-suffixed names: "niv" -> NIV11, "nasb" -> NASB1995.
      if (a.startsWith(q)) return 2;
      // Language-prefixed names: "kjv" -> engKJV.
      if (a.endsWith(q)) return 3;
      return 99;
    };
    const best = translations
      .map((t) => ({ t, s: score(t) }))
      .filter((x) => x.s < 99)
      // Shorter abbreviation wins a tie: NIV11 over NIVUK11.
      .sort((x, y) => x.s - y.s || x.t.abbreviation.length - y.t.abbreviation.length)[0];
    return best ? best.t.id : null;
  }, [translations]);

  // Resolves to the navigated target on success (so a mirror can bind its
  // send to it), or null on any failure / when a newer navigation won.
  const handleReferenceSearch = useCallback(async (
    reference: string
  ): Promise<{ chapterId: string; selKey: string; gen: number } | null> => {
    const trimmed = reference.trim();
    if (!trimmed) return null;
    const gen = ++navGenRef.current;

    // Normalize separators so "gen 1 20", "gen 1:20", "gen 1 : 20", and
    // "gen 1 20-25" / "gen 1 20 25" all parse the same way.
    let normalized = trimmed
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*/g, ':')
      .replace(/\s*-\s*/g, '-');

    // A trailing translation abbreviation switches the FIRST column and leaves
    // the others alone: "ps 112 2 nlt" -> Psalm 112:2 in NLT, Malayalam intact.
    // Only strip it when a parseable reference remains (so "mov" alone, or a
    // book whose name matches an abbreviation, isn't swallowed).
    let searchBibleId = primaryBibleId;
    const parts = normalized.split(' ');
    if (parts.length >= 3) {
      const last = parts[parts.length - 1];
      if (!/\d/.test(last)) {
        const targetId = findTranslationByAbbrev(last);
        if (targetId) {
          normalized = parts.slice(0, -1).join(' ');
          searchBibleId = targetId;
          setSelectedBibleIds((prev) => {
            if (prev[0] === targetId) return prev;
            const at = prev.indexOf(targetId);
            if (at > 0) {
              // Already shown in another column — promote it instead of duplicating.
              const next = [...prev];
              [next[0], next[at]] = [next[at], next[0]];
              return next;
            }
            return prev.map((id, i) => (i === 0 ? targetId : id));
          });
        }
      }
    }

    // [\p{L}\p{M}] accepts non-Latin book names — Indic scripts need \p{M}
    // for combining vowel signs/conjuncts (e.g. യോഹന്നാൻ).
    // chapter[:| ]verse[-| ]endVerse — colon and space are interchangeable.
    const match = normalized.match(/^(\d? ?[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*) (\d+)(?:[: ](\d+)(?:[- ](\d+))?)?$/u);
    if (!match) {
      setError('Reference not found. Try John 3:16, Gen 1 20, or Gen 1:1-5.');
      return null;
    }
    const bookQuery = match[1].trim().toLowerCase();
    const chapterNum = match[2];
    const startVerse = match[3];
    const endVerse = match[4];

    // Match conventional abbreviations (jn, ps, dt...), localized name,
    // English nameLong, or abbreviation — so English input keeps working
    // when a non-English translation is primary.
    const aliasId = resolveBookAlias(bookQuery);
    const matchedBook = books.find((b) => {
      const name = b.name.toLowerCase();
      const nameLong = (b.nameLong || '').toLowerCase();
      const abbr = b.abbreviation.toLowerCase();
      return (
        b.id === aliasId ||
        // USFM id, e.g. a mirrored "JHN 3:16" passage.
        b.id.toLowerCase() === bookQuery ||
        name === bookQuery || name.startsWith(bookQuery) ||
        nameLong === bookQuery || nameLong.startsWith(bookQuery) ||
        abbr === bookQuery
      );
    });
    if (!matchedBook) {
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
      return null;
    }

    // Until this lookup lands, the PREVIOUS chapter/verse is still selected
    // (and "ready"); sends made meanwhile must queue for the new reference.
    searchGenRef.current = gen;
    try {
      setError(null);
      const chaptersData = await bibleApi.getChapters(searchBibleId, matchedBook.id);
      // A newer navigation happened while this was in flight — drop it.
      if (gen !== navGenRef.current) return null;
      const matchedChapter = chaptersData.find((c) => c.number === chapterNum);
      if (!matchedChapter) {
        setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
        if (pendingSendRef.current?.gen === gen) dropPending('Reference not found');
        return null;
      }
      setChapters(chaptersData);
      setSelectedBook(matchedBook);
      setSelectedChapter(matchedChapter);
      const nextSelection: VerseSelection | null = startVerse
        ? { start: Number(startVerse), end: Number(endVerse || startVerse) }
        : null;
      setSelection(nextSelection);
      return { chapterId: matchedChapter.id, selKey: selKey(nextSelection), gen };
    } catch (err) {
      if (gen !== navGenRef.current) return null;
      console.error('Error searching reference:', err);
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
      if (pendingSendRef.current?.gen === gen) dropPending('Reference not found');
      return null;
    } finally {
      if (searchGenRef.current === gen) searchGenRef.current = null;
      if (gen === navGenRef.current) {
        // Re-check queued sends even if the lookup landed on the same
        // chapter/verse (no state change would re-run the effect).
        setPendingTick((t) => t + 1);
      }
    }
  }, [books, primaryBibleId, findTranslationByAbbrev]);

  const handleBreadcrumbClick = useCallback((level: 'root' | 'book') => {
    navGenRef.current++;
    if (level === 'root') {
      setSelectedBook(null);
      setSelectedChapter(null);
      setSelection(null);
      setChapters([]);
      setFullChapters({});
      setError(null);
    } else if (level === 'book') {
      setSelectedChapter(null);
      setSelection(null);
      setFullChapters({});
      setError(null);
    }
  }, []);

  // Recents & pins ----------------------------------------------------------
  const [recents, setRecents] = useState<string[]>([]);
  // A pin remembers the translation columns it was made with, so opening it
  // restores the same view. Older pins were plain strings — normalize them.
  type Pin = { ref: string; bibles?: string[] };
  const [pins, setPins] = useState<Pin[]>([]);
  const isPinned = (ref: string) =>
    PERMANENT_PINS.some((p) => p.ref === ref) || pins.some((p) => p.ref === ref);
  useEffect(() => {
    try { setRecents(JSON.parse(localStorage.getItem('bible-recents') || '[]')); } catch {}
    try {
      const raw = JSON.parse(localStorage.getItem('bible-pins') || '[]');
      if (Array.isArray(raw)) {
        setPins(
          raw
            .map((p: unknown) => (typeof p === 'string' ? { ref: p } : (p as Pin)))
            .filter((p: Pin) => p && typeof p.ref === 'string')
        );
      }
    } catch {}
  }, []);

  // Team role: media proposes verses, worship gets an accept prompt.
  // guest is view-only (see lib/role.ts): it neither publishes nor listens for
  // suggestions and sends/clears nothing — browsing, translations, pins and
  // history still work. Unknown roles keep the old 'worship' fallback.
  const [role, setRole] = useState<'media' | 'worship' | 'admin' | 'guest'>('worship');
  useEffect(() => {
    const saved = getRole();
    if (saved) setRole(saved);
  }, []);
  // Verses detected in the live sermon captions: media only for now.
  // Sermon verse detection: the wall team (media) and admin.
  const canDetect = role === 'media' || role === 'admin';
  const verseDetect = useVerseDetect(canDetect);

  // Wall-output layout (preset + blur + box size) — media/admin adjustable,
  // persisted server-side and applied live on the Resolume/OBS capture page.
  const [outputCfg, setOutputCfg] = useState<WallCfg>({ blur: 14, box_w_px: 0, box_h_px: 0, text_scale: 1, layout: 'imag', fade_ms: 600 });
  const [outputCfgLoaded, setOutputCfgLoaded] = useState(false);
  const [showWallLayout, setShowWallLayout] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  // Box width/height being typed — committed on blur/Enter, Escape reverts.
  const [boxDraft, setBoxDraft] = useState<{ field: 'box_w_px' | 'box_h_px'; value: string } | null>(null);
  const boxEscapeRef = useRef(false);
  // Latest save wins: only the newest response may overwrite the UI.
  const cfgSaveSeqRef = useRef(0);
  const cfgInFlightRef = useRef(0);
  // True while a debounced slider save is pending or a save is in flight, so
  // the poll never clobbers a value being edited.
  const cfgDirtyRef = useRef(false);
  const cfgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgQueuedRef = useRef<WallCfg | null>(null);

  useEffect(() => {
    liveApi.getOutputConfig()
      .then((c) => {
        setOutputCfg(toWallCfg(c));
        setOutputCfgLoaded(true);
      })
      .catch((err) => console.error('Error loading wall layout:', err));
  }, []);

  const saveOutputCfg = useCallback((next: WallCfg) => {
    if (cfgTimerRef.current) {
      clearTimeout(cfgTimerRef.current);
      cfgTimerRef.current = null;
    }
    cfgQueuedRef.current = null;
    setOutputCfg(next);
    const seq = ++cfgSaveSeqRef.current;
    cfgInFlightRef.current++;
    cfgDirtyRef.current = true;
    setSavingCfg(true);
    liveApi.setOutputConfig(next)
      .then((resp) => {
        // The server clamps values; show what the wall actually uses.
        if (seq === cfgSaveSeqRef.current) setOutputCfg(toWallCfg(resp));
      })
      .catch((err) => {
        console.error('Error saving wall layout:', err);
        setError('Could not save the wall layout. Check the backend connection.');
        // Revert the panel to what the server really has.
        liveApi.getOutputConfig()
          .then((c) => { if (seq === cfgSaveSeqRef.current) setOutputCfg(toWallCfg(c)); })
          .catch(() => {});
      })
      .finally(() => {
        cfgInFlightRef.current--;
        if (cfgInFlightRef.current === 0) {
          setSavingCfg(false);
          if (!cfgTimerRef.current) cfgDirtyRef.current = false;
        }
      });
  }, []);

  // Sliders: update the UI immediately, POST at most every ~250ms.
  const queueOutputCfgSave = useCallback((next: WallCfg) => {
    setOutputCfg(next);
    cfgDirtyRef.current = true;
    cfgQueuedRef.current = next;
    if (cfgTimerRef.current) clearTimeout(cfgTimerRef.current);
    cfgTimerRef.current = setTimeout(() => {
      cfgTimerRef.current = null;
      const queued = cfgQueuedRef.current;
      if (queued) saveOutputCfg(queued);
    }, 250);
  }, [saveOutputCfg]);

  // On unmount, flush a pending slider save so the last value isn't lost.
  useEffect(() => () => {
    if (cfgTimerRef.current) {
      clearTimeout(cfgTimerRef.current);
      cfgTimerRef.current = null;
      const queued = cfgQueuedRef.current;
      cfgQueuedRef.current = null;
      if (queued) liveApi.setOutputConfig(queued).catch(() => {});
    }
  }, []);

  // While the panel is open, follow changes made from other machines.
  const showWallPanel = (role === 'media' || role === 'admin') && showWallLayout;
  useEffect(() => {
    if (!showWallPanel) return;
    let cancelled = false;
    const poll = () => {
      liveApi.getOutputConfig()
        .then((c) => {
          if (cancelled || cfgDirtyRef.current || cfgInFlightRef.current > 0) return;
          const next = toWallCfg(c);
          setOutputCfg((prev) => (sameWallCfg(prev, next) ? prev : next));
          setOutputCfgLoaded(true);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [showWallPanel]);

  // Saved wall layout presets (server-side, shared by every machine).
  const [wallPresets, setWallPresets] = useState<WallPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [presetName, setPresetName] = useState('');
  const presetsInitRef = useRef(false);
  const loadWallPresets = useCallback(
    () =>
      liveApi.getWallPresets()
        .then(setWallPresets)
        .catch((err) => console.error('Error loading wall presets:', err))
        .finally(() => setPresetsLoaded(true)),
    []
  );
  useEffect(() => {
    loadWallPresets();
  }, [loadWallPresets]);
  const presetMatches = (p: WallPreset, cfg: WallCfg) =>
    p.layout === cfg.layout &&
    p.blur === cfg.blur &&
    p.box_w_px === cfg.box_w_px &&
    p.box_h_px === cfg.box_h_px &&
    Math.abs(p.text_scale - cfg.text_scale) < 0.001;
  const matchedPreset = useMemo(
    () => wallPresets.find((p) => presetMatches(p, outputCfg)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallPresets, outputCfg]
  );
  const selectedPreset = useMemo(
    () => wallPresets.find((p) => p.id === selectedPresetId) ?? null,
    [wallPresets, selectedPresetId]
  );
  // Once BOTH presets and the live config have loaded, pre-select the preset
  // matching the live config (matching against the default config would pick
  // the wrong one).
  useEffect(() => {
    if (presetsInitRef.current || !presetsLoaded || !outputCfgLoaded) return;
    presetsInitRef.current = true;
    if (selectedPresetId === null && matchedPreset) setSelectedPresetId(matchedPreset.id);
  }, [presetsLoaded, outputCfgLoaded, matchedPreset, selectedPresetId]);

  const applyPreset = useCallback((p: WallPreset) => {
    setSelectedPresetId(p.id);
    saveOutputCfg({
      blur: p.blur,
      box_w_px: p.box_w_px,
      box_h_px: p.box_h_px,
      text_scale: p.text_scale,
      layout: p.layout === 'fullscreen' ? 'fullscreen' : 'imag',
      // Presets are layout only; the fade is an operator preference.
      fade_ms: outputCfg.fade_ms,
    });
  }, [saveOutputCfg, outputCfg.fade_ms]);

  const handleSavePreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) return;
    if (wallPresets.some((p) => p.name === name) && !confirm(`Overwrite preset "${name}"?`)) return;
    try {
      const saved = await liveApi.saveWallPreset({ name, ...outputCfg });
      setSelectedPresetId(saved.id);
      setPresetName('');
      await loadWallPresets();
    } catch (error) {
      console.error('Error saving wall preset:', error);
      setError(`Could not save preset "${name}". Check the backend connection.`);
    }
  }, [presetName, wallPresets, outputCfg, loadWallPresets]);

  const handleUpdatePreset = useCallback(async () => {
    const p = selectedPreset;
    if (!p) return;
    if (!confirm(`Update "${p.name}" with the current settings?`)) return;
    try {
      await liveApi.saveWallPreset({ name: p.name, ...outputCfg });
      await loadWallPresets();
    } catch (error) {
      console.error('Error updating wall preset:', error);
      setError(`Could not update preset "${p.name}". Check the backend connection.`);
    }
  }, [selectedPreset, outputCfg, loadWallPresets]);

  const handleDeletePreset = useCallback(async (p: WallPreset) => {
    if (p.builtin) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    try {
      await liveApi.deleteWallPreset(p.id);
      if (selectedPresetId === p.id) setSelectedPresetId(null);
      await loadWallPresets();
    } catch (error) {
      console.error('Error deleting wall preset:', error);
      setError(`Could not delete preset "${p.name}". Check the backend connection.`);
    }
  }, [selectedPresetId, loadWallPresets]);

  // Box width/height inputs: edit a draft, commit on blur/Enter, Escape reverts.
  const boxInputProps = (field: 'box_w_px' | 'box_h_px') => ({
    value: boxDraft?.field === field ? boxDraft.value : String(outputCfg[field]),
    onFocus: () => setBoxDraft({ field, value: String(outputCfg[field]) }),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBoxDraft({ field, value: e.target.value }),
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      const escaped = boxEscapeRef.current;
      boxEscapeRef.current = false;
      setBoxDraft(null);
      if (escaped) return;
      const v = Math.max(0, Math.round(Number(e.currentTarget.value) || 0));
      if (v !== outputCfg[field]) saveOutputCfg({ ...outputCfg, [field]: v });
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        boxEscapeRef.current = true;
        setBoxDraft(null);
        e.currentTarget.blur();
      }
    },
  });

  // Human-readable reference of what is currently on screen, e.g. "John 3:16-18".
  const currentReference = useMemo(() => {
    if (!selectedBook || !selectedChapter) return null;
    let ref = `${selectedBook.name} ${selectedChapter.number}`;
    if (selection) {
      ref += `:${selection.start}${selection.end !== selection.start ? `-${selection.end}` : ''}`;
    }
    return ref;
  }, [selectedBook, selectedChapter, selection]);

  // Language-neutral form of currentReference ("JHN 3:16-18", USFM book id).
  // Suggestions carry this so the other team can navigate to it whatever
  // their translations call the book.
  const currentPassage = useMemo(() => {
    if (!selectedBook || !selectedChapter) return null;
    let p = `${selectedBook.id} ${selectedChapter.number}`;
    if (selection) {
      p += `:${selection.start}${selection.end !== selection.start ? `-${selection.end}` : ''}`;
    }
    return p;
  }, [selectedBook, selectedChapter, selection]);

  // Record a verse-level view in recents after a 2s dwell, so stepping
  // through verses with the arrow keys doesn't flood the history.
  useEffect(() => {
    if (!currentReference || !selection) return;
    const t = setTimeout(() => {
      setRecents((prev) => {
        const next = [currentReference, ...prev.filter((r) => r !== currentReference)].slice(0, 5);
        try { localStorage.setItem('bible-recents', JSON.stringify(next)); } catch {}
        return next;
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [currentReference, selection]);

  const togglePin = useCallback((ref: string) => {
    setPins((prev) => {
      const exists = prev.some((p) => p.ref === ref);
      const next = exists
        ? prev.filter((p) => p.ref !== ref)
        : [{ ref, bibles: selectedBibleIds }, ...prev].slice(0, 12);
      try { localStorage.setItem('bible-pins', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [selectedBibleIds]);

  // Opening a pin restores the translation columns it was pinned with
  // (ignoring any that no longer exist), then loads the reference.
  const openPin = useCallback((pin: Pin) => {
    if (pin.bibles && pin.bibles.length > 0) {
      const valid = normalizeBibleIds(pin.bibles)
        .filter((id) => translations.some((t) => t.id === id))
        .slice(0, MAX_COLUMNS);
      if (valid.length > 0) setSelectedBibleIds(valid);
    }
    handleReferenceSearch(pin.ref);
  }, [translations, handleReferenceSearch]);

  const [suggestion, setSuggestion] = useState<{ reference: string; passage?: string; updated_at: number; bibles?: string[] } | null>(null);
  const seenSuggestionRef = useRef<number>(0);

  // Which incoming verses go to the wall without confirmation: Jev's sermon
  // detections, worship's live verses (media only), both, or neither. Not
  // auto = a banner the operator confirms (Shift+Enter / Enter).
  const [autoMode, setAutoMode] = useState<AutoMode>('worship');
  useEffect(() => {
    try {
      const v = localStorage.getItem(AUTO_MODE_KEY);
      if (v && AUTO_MODES.some((m) => m.value === v)) {
        setAutoMode(v as AutoMode);
      } else {
        // Before the modes existed this was a plain auto-mirror switch.
        const legacy = localStorage.getItem('bible-auto-mirror');
        if (legacy !== null) setAutoMode(legacy === '1' ? 'worship' : 'off');
      }
    } catch {}
  }, []);
  const autoMirror = autoMode === 'all' || autoMode === 'worship';
  const changeAutoMode = (next: AutoMode) => {
    const mirrorWasAuto = autoMirror;
    try { localStorage.setItem(AUTO_MODE_KEY, next); } catch {}
    setAutoMode(next);
    // Turning auto-mirror on while a "Worship is live with…" banner waits:
    // follow it now, as auto-mirror would have, instead of leaving a stale
    // banner that could later re-send an old verse.
    if (!mirrorWasAuto && (next === 'all' || next === 'worship') && role === 'media' && suggestion) {
      seenSuggestionRef.current = suggestion.updated_at;
      applyMirror(suggestion.passage || suggestion.reference, suggestion.bibles);
      setSuggestion(null);
    }
  };

  // When set, send as soon as the navigated chapter's content is loaded
  // (navigation is instant, the chapter text arrives async). Bound to the
  // navigation it was requested for — see PendingSend. 'mirror' is a wall
  // send triggered by mirroring worship.
  const pendingSendRef = useRef<PendingSend | null>(null);
  // Re-runs the fire effect when a pending send is queued asynchronously.
  const [pendingTick, setPendingTick] = useState(0);
  // Replace the queued send; anything replaced or dropped tells its remote
  // caller it did not happen.
  const setPending = (p: PendingSend | null, reason = 'Superseded by another navigation') => {
    const old = pendingSendRef.current;
    pendingSendRef.current = p;
    if (old && old !== p) old.settle?.(false, reason);
  };
  const dropPending = (reason: string) => setPending(null, reason);
  // Marks the next wall send as mirror-triggered (suppresses re-publishing).
  const mirrorSendRef = useRef(false);
  // Panel root, to tell whether the Bible tab is the one on screen.
  const rootRef = useRef<HTMLDivElement>(null);
  // What this screen is currently showing, for the same-verse guard below.
  const currentReferenceRef = useRef<string | null>(null);
  currentReferenceRef.current = currentReference;
  const currentPassageRef = useRef<string | null>(null);
  currentPassageRef.current = currentPassage;
  // What this machine last put on the wall (passage + columns); null after
  // a Clear. Media's "already live" guard compares against this — not
  // against what happens to be on screen, which may only be a preview.
  const lastWallKeyRef = useRef<string | null>(null);

  // Mirror worship's passage AND translation columns, then queue the wall
  // send bound to the mirrored chapter + selection + columns, so the old
  // chapter's verse (or old columns) can never be what goes out.
  const applyMirror = useCallback(async (reference: string, bibles?: string[]) => {
    let mirrored: string[] | undefined;
    if (bibles && bibles.length > 0) {
      const valid = normalizeBibleIds(bibles)
        .filter((id) => translations.some((t) => t.id === id))
        .slice(0, MAX_COLUMNS);
      if (valid.length > 0) {
        mirrored = valid;
        setSelectedBibleIds((prev) =>
          prev.length === valid.length && prev.every((id, i) => id === valid[i]) ? prev : valid
        );
      }
    }
    dropPending('Superseded by another navigation');
    const target = await handleReferenceSearch(reference);
    // Failed or superseded search: the error (if any) is already shown.
    if (!target) return;
    setPending({
      kind: 'mirror',
      gen: target.gen,
      chapterId: target.chapterId,
      selKey: target.selKey,
      bibles: mirrored,
    });
    setPendingTick((t) => t + 1);
  }, [translations, handleReferenceSearch]);

  // Both teams poll the shared suggestion channel, each listening only for
  // the other side: worship hears media's proposals, media hears what
  // worship took live.
  // Latest values for the poller, so the interval isn't torn down (and its
  // timing reset) every time one of them changes.
  const autoMirrorRef = useRef(autoMirror);
  autoMirrorRef.current = autoMirror;
  const applyMirrorRef = useRef(applyMirror);
  applyMirrorRef.current = applyMirror;
  useEffect(() => {
    // null for admin and guest — guest never sees suggestion banners.
    const listenFor = role === 'worship' ? 'media' : role === 'media' ? 'worship' : null;
    if (!listenFor) return;
    // Baseline against the SERVER's latest suggestion rather than this
    // machine's clock: a clock behind the server would otherwise replay an
    // old suggestion on load (and auto-mirror it to the wall); one ahead
    // would ignore new ones until it caught up.
    let baselined = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const sug = await liveApi.getSuggestion();
        if (!baselined) {
          baselined = true;
          seenSuggestionRef.current = Math.max(seenSuggestionRef.current, sug.updated_at || 0);
          return;
        }
        if (!sug.reference || sug.updated_at <= seenSuggestionRef.current) return;
        if ((sug.from || 'media') !== listenFor) return;
        const target = sug.passage || sug.reference;
        if (role === 'media') {
          // Worship re-sent what this machine already has on the wall
          // (same passage AND columns): nothing to do.
          const key = sug.passage ? wallKey(sug.passage, sug.bibles) : null;
          if (key && key === lastWallKeyRef.current) {
            seenSuggestionRef.current = sug.updated_at;
            return;
          }
          if (autoMirrorRef.current) {
            seenSuggestionRef.current = sug.updated_at;
            setSuggestion(null);
            applyMirrorRef.current(target, sug.bibles);
            return;
          }
        } else if (
          (sug.passage && sug.passage === currentPassageRef.current) ||
          sug.reference === currentReferenceRef.current
        ) {
          // Worship is already looking at the suggested verse.
          seenSuggestionRef.current = sug.updated_at;
          return;
        }
        setSuggestion({ reference: sug.reference, passage: sug.passage, updated_at: sug.updated_at, bibles: sug.bibles });
      } catch {
        // Transient poll failure — try again next tick.
      } finally {
        inFlight = false;
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [role]);

  // Ctrl/Cmd+Enter accepts a pending suggestion banner (worship: open it;
  // media: mirror it to the wall), skipped while typing in a field. Plain
  // Enter stays the operator's own send, banner or not.
  useEffect(() => {
    if (!suggestion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      seenSuggestionRef.current = suggestion.updated_at;
      if (role === 'media') applyMirror(suggestion.passage || suggestion.reference, suggestion.bibles);
      else handleReferenceSearch(suggestion.passage || suggestion.reference);
      setSuggestion(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [suggestion, role, applyMirror, handleReferenceSearch]);

  // Wall output -------------------------------------------------------------
  const [wallState, setWallState] = useState<'idle' | 'sending' | 'live'>('idle');

  // BroadcastChannel to the same-machine /display window.
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const ch = new BroadcastChannel('lyrics-display');
    displayChannelRef.current = ch;
    return () => { ch.close(); displayChannelRef.current = null; };
  }, []);

  // Navigation updates the chapter and verse selection immediately, but
  // fullChapters keeps the PREVIOUS chapter's text until the new fetch lands.
  // Building columns in that gap pairs the new verse numbers with the old
  // chapter — the wrong verse, or an empty one whose lone reference label
  // auto-fits to fill the whole box. Sends wait until this is true.
  const chapterReady =
    !!selectedChapter &&
    fullChaptersRef.current.chapterId === selectedChapter.id &&
    selectedBibleIds.every((id) => fullChapters[id] !== undefined);

  // Build LEFT=English / RIGHT=Malayalam columns for outputs.
  const buildScriptureColumns = useCallback(() => {
    const candidates = selectedBibleIds
      .map((id) => {
        const t = translations.find((x) => x.id === id);
        const data = fullChapters[id];
        if (!data?.content) return null;
        return {
          langId: t?.language?.id || '',
          column: {
            abbreviation: t?.abbreviation || '',
            reference: referenceString(data.reference, selection),
            content: renderSelection(data.content, selection),
            indic: INDIC_LANGS.has(t?.language?.id || ''),
          },
        };
      })
      .filter(Boolean) as { langId: string; column: { abbreviation: string; reference: string; content: string; indic: boolean } }[];
    if (candidates.length === 0) return [];
    const english = candidates.find((c) => c.langId === 'eng');
    const malayalam = candidates.find((c) => c.langId === 'mal');
    const left = english || candidates.find((c) => c !== malayalam) || candidates[0];
    const right = malayalam || candidates.find((c) => c !== left) || left;
    return [left.column, right.column];
  }, [selectedBibleIds, translations, fullChapters, selection]);

  // Send the current selection to the LED-wall output page via the backend.
  // Queue a send for when the current navigation's chapter text arrives.
  const queuePendingSend = useCallback((kind: 'wall' | 'display') => {
    if (!selectedChapter) return;
    const cur = pendingSendRef.current;
    // Never downgrade a pending mirror for this same navigation.
    if (cur && cur.kind === 'mirror' && cur.gen === navGenRef.current) return;
    // A cross-boundary arrow step or reference lookup is still landing:
    // accept wherever it lands.
    const stepInFlight =
      !!pendingVerseRef.current || !!pendingChapterRef.current || isSearchInFlight();
    setPending({
      kind,
      gen: navGenRef.current,
      chapterId: stepInFlight ? '*' : selectedChapter.id,
      selKey: stepInFlight ? '*' : selKey(selection),
    });
  }, [selectedChapter, selection]);

  const handleSendToWall = useCallback(async (): Promise<SendOutcome> => {
    if (isGuest() || !selectedChapter) return { ok: false, message: 'Nothing to send' };
    if (!chapterReady || isSearchInFlight()) {
      queuePendingSend('wall');
      return { ok: true, message: 'Queued' };
    }
    const columns = buildScriptureColumns();
    if (columns.length === 0) {
      mirrorSendRef.current = false;
      setError('Nothing to send — the selected passage has no text in the chosen translations.');
      return { ok: false, message: 'Nothing to send — no text in the chosen translations' };
    }
    // A wall send triggered by mirroring worship must not re-publish a media
    // suggestion — that would echo worship's own verse back to them.
    const isMirrorSend = mirrorSendRef.current;
    mirrorSendRef.current = false;

    try {
      setWallState('sending');
      await liveApi.setScripture(columns);
      lastWallKeyRef.current = currentPassage ? wallKey(currentPassage, selectedBibleIds) : null;
      displayChannelRef.current?.postMessage({ type: 'scripture', columns });
      if (role === 'media' && columns[0] && !isMirrorSend) {
        liveApi.setSuggestion(columns[0].reference, 'media', undefined, currentPassage ?? undefined).catch(() => {});
      }
      setWallState('live');
      return { ok: true, message: columns[0]?.reference };
    } catch (err) {
      console.error('Error sending scripture to wall:', err);
      setWallState('idle');
      setError('Could not send to the wall output. Check the backend connection.');
      return { ok: false, message: 'Could not send to the wall' };
    }
  }, [selectedChapter, chapterReady, buildScriptureColumns, role, queuePendingSend, currentPassage, selectedBibleIds]);

  // Send the current selection to the same-machine /display window. When
  // worship takes a verse live, publish it so the media machine can mirror.
  const handleSendToDisplay = useCallback((): SendOutcome => {
    if (isGuest() || !selectedChapter) return { ok: false, message: 'Nothing to send' };
    if (!chapterReady || isSearchInFlight()) {
      queuePendingSend('display');
      return { ok: true, message: 'Queued' };
    }
    const columns = buildScriptureColumns();
    if (columns.length === 0) {
      setError('Nothing to send — the selected passage has no text in the chosen translations.');
      return { ok: false, message: 'Nothing to send — no text in the chosen translations' };
    }
    displayChannelRef.current?.postMessage({ type: 'scripture', columns });
    if (role === 'worship' && columns[0]) {
      liveApi.setSuggestion(columns[0].reference, 'worship', selectedBibleIds, currentPassage ?? undefined).catch(() => {});
    }
    return { ok: true, message: columns[0]?.reference };
  }, [selectedChapter, chapterReady, buildScriptureColumns, role, selectedBibleIds, queuePendingSend, currentPassage]);

  // Enter sends the current selection to the wall/display (role-appropriate)
  // — always the operator's own choice, even while a suggestion banner waits
  // (Ctrl/Cmd+Enter accepts that). Skipped when no chapter is loaded.
  useEffect(() => {
    // guest is view-only: Enter sends nothing, so don't even listen.
    if (role === 'guest' || !selectedChapter) return;
    const onKey = (e: KeyboardEvent) => {
      // Shift+Enter belongs to the verse-detection banner, Ctrl/Cmd+Enter to
      // the suggestion banner.
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      // A focused button/link (outside verse/chapter/pin navigation) gets
      // its own Enter activation instead of a send.
      if (isActivatableControl(e.target)) return;
      e.preventDefault();
      if (role === 'media' || role === 'admin') {
        handleSendToWall();
      } else {
        handleSendToDisplay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedChapter, role, handleSendToWall, handleSendToDisplay]);

  // Complete a queued send (mirror, or a push made while the chapter was
  // still loading) only for the exact navigation it was requested for, once
  // that chapter's own content (and every mirrored column) has arrived.
  // Fires at most once; any other navigation discards it.
  useEffect(() => {
    const p = pendingSendRef.current;
    if (!p) return;
    if (p.gen !== navGenRef.current) {
      dropPending('The operator moved on');
      return;
    }
    // A cross-boundary arrow step is still landing (new chapter/verse not
    // selected yet) — firing now would send the full chapter.
    if (pendingVerseRef.current || pendingChapterRef.current || isSearchInFlight()) return;
    if (!selectedChapter) {
      dropPending('The operator moved on');
      return;
    }
    const chapterOk = p.chapterId === '*' || p.chapterId === selectedChapter.id;
    const selOk = p.selKey === '*' || p.selKey === selKey(selection);
    if (!chapterOk || !selOk) {
      // Settled somewhere else: the operator moved on.
      dropPending('The operator moved on');
      return;
    }
    if (!chapterReady) return;
    if (
      p.bibles &&
      !(p.bibles.length === selectedBibleIds.length && p.bibles.every((id, i) => id === selectedBibleIds[i]))
    ) {
      return;
    }
    pendingSendRef.current = null; // firing now — settle with the real outcome
    if (p.kind === 'display') {
      const r = handleSendToDisplay();
      p.settle?.(r.ok, r.message);
    } else {
      mirrorSendRef.current = p.kind === 'mirror';
      handleSendToWall().then((r) => p.settle?.(r.ok, r.message));
    }
  }, [chapterReady, selectedChapter, selection, selectedBibleIds, pendingTick, handleSendToWall, handleSendToDisplay]);

  const handleClearWall = useCallback(async (): Promise<SendOutcome> => {
    if (isGuest()) return { ok: false, message: 'View-only account' };
    // A queued send must not put text back up after the operator cleared.
    dropPending('Cleared');
    lastWallKeyRef.current = null;
    displayChannelRef.current?.postMessage({ type: 'scripture-clear' });
    try {
      await liveApi.clearScripture();
      setWallState('idle');
      return { ok: true, message: 'Cleared' };
    } catch (err) {
      console.error('Error clearing wall:', err);
      // Leave wallState alone: the wall may still be showing text.
      setError('Could not clear the wall output. Check the backend connection.');
      return { ok: false, message: 'Could not clear the wall' };
    }
  }, []);

  // Esc clears the wall — the pair to Enter sending it. Only while the Bible
  // tab is showing and no dialog is open (dialogs close on Esc themselves).
  useEffect(() => {
    if (role === 'guest') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (!rootRef.current?.getClientRects().length) return;
      if (document.querySelector('.fixed.inset-0, [role="dialog"]')) return;
      e.preventDefault();
      handleClearWall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, handleClearWall]);


  // Derived -----------------------------------------------------------------
  const verseNumbers = useMemo(
    () => verseNumbersOf(fullChapters[primaryBibleId]?.content || ''),
    [fullChapters, primaryBibleId]
  );
  const selectedVerse =
    selection && selection.start === selection.end ? String(selection.start) : null;

  // Consume pending chapter once the new book's chapter list arrives.
  useEffect(() => {
    if (!pendingChapterRef.current || chapters.length === 0) return;
    const target = pendingChapterRef.current === 'first' ? chapters[0] : chapters[chapters.length - 1];
    pendingChapterRef.current = null;
    setSelectedChapter(target);
  }, [chapters]);

  // Consume pending verse once the new chapter's verses arrive.
  useEffect(() => {
    if (!pendingVerseRef.current || verseNumbers.length === 0) return;
    const num = Number(pendingVerseRef.current === 'first' ? verseNumbers[0] : verseNumbers[verseNumbers.length - 1]);
    pendingVerseRef.current = null;
    setSelection({ start: num, end: num });
  }, [verseNumbers]);

  // Step one verse, flowing across chapter and book boundaries. Reassigned
  // every render so it always sees current state; returns whether it moved.
  // Shared by the arrow keys and the phone remote.
  const stepRef = useRef<(dir: 1 | -1) => boolean>(() => false);
  stepRef.current = (dir) => {
    if (!selection || selection.start !== selection.end) return false;
    const idx = verseNumbers.indexOf(String(selection.start));
    if (idx === -1) return false;
    const next = idx + dir;
    if (next >= 0 && next < verseNumbers.length) {
      const n = Number(verseNumbers[next]);
      navGenRef.current++;
      setSelection({ start: n, end: n });
      return true;
    }
    // Chapter boundary
    if (!selectedChapter) return false;
    const cIdx = chapters.findIndex((c) => c.id === selectedChapter.id);
    const nextChapter = chapters[cIdx + dir];
    if (nextChapter) {
      navGenRef.current++;
      pendingVerseRef.current = dir === 1 ? 'first' : 'last';
      setSelection(null);
      setSelectedChapter(nextChapter);
      return true;
    }
    // Book boundary
    if (!selectedBook) return false;
    const bIdx = books.findIndex((b) => b.id === selectedBook.id);
    const nextBook = books[bIdx + dir];
    if (!nextBook) return false;
    navGenRef.current++;
    pendingChapterRef.current = dir === 1 ? 'first' : 'last';
    pendingVerseRef.current = dir === 1 ? 'first' : 'last';
    setSelection(null);
    setSelectedChapter(null);
    setSelectedBook(nextBook);
    return true;
  };

  // Arrow keys step verses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepRef.current(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Remote (paired phone) commands -------------------------------------------
  // Map a requested target onto this window's role: wall = media/admin,
  // display = worship/admin, auto = what Enter would do. A string that isn't
  // 'wall'/'display' is the refusal reason.
  const resolveTarget = (t: 'auto' | 'wall' | 'display'): 'wall' | 'display' | string => {
    if (role === 'guest') return 'View-only account';
    if (t === 'auto') return role === 'worship' ? 'display' : 'wall'; // same choice Enter makes
    if (t === 'wall' && role === 'worship') return 'This window drives the display, not the wall';
    if (t === 'display' && role === 'media') return 'This window drives the wall, not the display';
    return t;
  };

  // Resolves once the queued send really fires (or is dropped), capped at
  // SETTLE_CAP_MS so the phone isn't left hanging on a slow chapter load.
  const awaitSettle = (make: (settle: (ok: boolean, m?: string) => void) => void) =>
    new Promise<SendOutcome>((resolve) => {
      let done = false;
      const finish = (ok: boolean, message?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok, message });
      };
      const timer = setTimeout(() => {
        // Still loading: drop it so it can't fire later after we told the phone it failed.
        if (!done && pendingSendRef.current?.settle === finish) dropPending('Timed out');
        finish(false, 'Still loading — not sent');
      }, SETTLE_CAP_MS);
      make(finish);
    });

  const handleRef = useRef<BiblePanelHandle>({
    lookupAndSend: async () => ({ ok: false }),
    step: async () => ({ ok: false }),
    clear: async () => ({ ok: false }),
  });
  handleRef.current = {
    lookupAndSend: async (reference, target) => {
      const k = resolveTarget(target);
      if (k !== 'wall' && k !== 'display') return { ok: false, message: k };
      dropPending('Superseded by another navigation');
      const t = await handleReferenceSearch(reference);
      if (!t) return { ok: false, message: 'Reference not found' };
      // Never send directly here: the fire effect waits for the new chapter's
      // own text, so the old/whole chapter can't flash up.
      return awaitSettle((settle) => {
        setPending({ kind: k, gen: t.gen, chapterId: t.chapterId, selKey: t.selKey, settle });
        setPendingTick((n) => n + 1);
      });
    },
    step: async (dir, send) => {
      let k: string = 'wall';
      if (send) {
        k = resolveTarget('auto');
        if (k !== 'wall' && k !== 'display') return { ok: false, message: k };
      }
      const moved = stepRef.current(dir);
      if (!moved) return { ok: false, message: 'Select a single verse first (or end of the Bible)' };
      if (!send) return { ok: true, message: 'Moved' };
      const kind = k as 'wall' | 'display';
      // Queue synchronously after the step: accept wherever it lands.
      return awaitSettle((settle) => {
        setPending({ kind, gen: navGenRef.current, chapterId: '*', selKey: '*', settle });
        setPendingTick((n) => n + 1);
      });
    },
    clear: () => handleClearWall(),
  };
  useImperativeHandle(ref, () => ({
    lookupAndSend: (r, t) => handleRef.current.lookupAndSend(r, t),
    step: (d, s) => handleRef.current.step(d, s),
    clear: () => handleRef.current.clear(),
  }), []);

  // Auto (Jev): send each new detection straight to the wall through the same
  // pending-send-safe path the banner's Shift+Enter uses. Only detections made
  // after auto was switched on, so a reload or mode change never replays an
  // old one; anything that fails to send stays up as a banner to confirm.
  const autoJev = canDetect && (autoMode === 'all' || autoMode === 'jev');
  const autoJevSinceRef = useRef(0);
  const autoJevSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoJev) autoJevSinceRef.current = Date.now();
  }, [autoJev]);
  const detection = verseDetect.detection;
  const dismissDetection = verseDetect.dismiss;
  useEffect(() => {
    if (!autoJev || !detection || autoJevSentRef.current === detection.id) return;
    if (detection.detectedAt < autoJevSinceRef.current) return;
    autoJevSentRef.current = detection.id;
    // Already on the wall (the preacher repeated it): nothing to send.
    if (lastWallKeyRef.current === wallKey(detection.passage, selectedBibleIds)) {
      dismissDetection(detection.id);
      return;
    }
    handleRef.current.lookupAndSend(detection.passage, 'wall')
      .then((r) => {
        if (r.ok) dismissDetection(detection.id);
        else console.warn('Auto-send of detected verse did not go out:', detection.reference, r.message);
      })
      .catch((err) => console.error('Auto-send of detected verse failed:', detection.reference, err));
    // selectedBibleIds is only read for the repeat check, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJev, detection, dismissDetection]);

  return (
    <div ref={rootRef} className="px-4 sm:px-6 py-5 space-y-4">
      {/* Toolbar: reference search + translation columns, one grouped card */}
      <div className="bg-surface-raised border border-edge rounded-xl p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]">
          <ReferenceSearch onSearch={handleReferenceSearch} isLoading={isLoadingContent} />
        </div>
        <div className="hidden lg:block w-px self-stretch bg-edge" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          {selectedBibleIds.map((id, index) => {
            const options = translations.filter(
              (t) => t.id === id || !selectedBibleIds.includes(t.id)
            );
            return (
              <div
                key={`${id}-${index}`}
                className="flex items-center rounded-lg border border-edge bg-surface-input overflow-hidden"
              >
                <div className="w-48 [&_select]:border-0 [&_select]:rounded-none [&_select]:bg-transparent">
                  <TranslationSelector
                    translations={options}
                    selectedId={id}
                    onSelect={(newId) => handleChangeSlot(index, newId)}
                    isLoading={isLoadingTranslations}
                  />
                </div>
                {selectedBibleIds.length > 1 && (
                  <button
                    onClick={() => handleRemoveSlot(index)}
                    title="Remove translation"
                    aria-label="Remove translation"
                    className="h-9 w-8 flex items-center justify-center border-l border-edge text-ink-mute hover:text-danger hover:bg-danger/10 cursor-pointer transition-colors duration-150"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {(role === 'media' || (role === 'admin' && verseDetect.available)) && (
            <label
              className={`h-9 pl-3 pr-1 flex items-center gap-2 rounded-lg border text-sm font-medium transition-colors duration-150 ${
                autoMode !== 'off'
                  ? 'bg-ok/10 border-ok/40 text-ok'
                  : 'bg-surface-input border-edge text-ink-dim hover:text-ink hover:border-edge-strong'
              }`}
              title={AUTO_MODES.find((m) => m.value === autoMode)?.title}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoMode !== 'off' ? 'bg-ok animate-pulse' : 'bg-edge-strong'}`} />
              <span className="sr-only">Send to wall automatically</span>
              <select
                value={role === 'admin' && (autoMode === 'all' || autoMode === 'worship') ? 'off' : autoMode}
                onChange={(e) => changeAutoMode(e.target.value as AutoMode)}
                className="h-full bg-transparent pr-1 cursor-pointer focus:outline-none"
              >
                {AUTO_MODES.filter((m) => role === 'media' || !m.mediaOnly).map((m) => (
                  <option key={m.value} value={m.value} className="bg-surface-raised text-ink">{m.label}</option>
                ))}
              </select>
            </label>
          )}
          {canDetect && verseDetect.available && (
            <VerseDetectToggle status={verseDetect.status} onToggle={verseDetect.setEnabled} />
          )}
          {selectedBibleIds.length < MAX_COLUMNS && (
            <button
              onClick={handleAddSlot}
              disabled={translations.every((t) => selectedBibleIds.includes(t.id))}
              title={
                translations.every((t) => selectedBibleIds.includes(t.id))
                  ? 'No more translations available — configure API_BIBLE_KEY on the backend for 200+ more'
                  : 'Add translation'
              }
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-dashed border-edge-strong text-ink-mute hover:text-ink hover:border-accent cursor-pointer transition-colors duration-150 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add</span>
            </button>
          )}
        </div>

      </div>

      {/* Pinned + recent passages (click then Enter sends: data-enter-sends) */}
      <div data-enter-sends className="flex flex-wrap items-center gap-1.5">
        {PERMANENT_PINS.map((pin) => (
          <button
            key={`permanent-${pin.ref}`}
            onClick={() => handleReferenceSearch(pin.ref)}
            title={`Open ${pin.ref}`}
            className="h-7 px-2.5 flex items-center gap-1.5 rounded-full bg-accent/10 border border-accent/40 text-accent-hover hover:text-ink cursor-pointer transition-colors duration-150 text-xs font-medium"
          >
            <PinIcon className="w-3 h-3" />
            {pin.label}
            <span className="text-accent-hover/60 font-normal">{pin.ref}</span>
          </button>
        ))}
        {pins.filter((pin) => !PERMANENT_PINS.some((p) => p.ref === pin.ref)).map((pin) => (
          <span
            key={`pin-${pin.ref}`}
            className="group flex items-center rounded-full bg-accent/10 border border-accent/40 overflow-hidden"
          >
            <button
              onClick={() => openPin(pin)}
              title={`Open ${pin.ref}`}
              className="h-7 pl-2.5 pr-1.5 flex items-center gap-1.5 text-accent-hover hover:text-ink cursor-pointer transition-colors duration-150 text-xs font-medium"
            >
              <PinIcon className="w-3 h-3" />
              {pin.ref}
            </button>
            <button
              onClick={() => togglePin(pin.ref)}
              title="Unpin"
              aria-label={`Unpin ${pin.ref}`}
              className="h-7 pr-2 pl-0.5 flex items-center text-accent-hover/50 hover:text-danger cursor-pointer transition-colors duration-150"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
        {recents.filter((r) => !isPinned(r)).length > 0 && (
          <span className="w-px h-4 bg-edge mx-0.5" aria-hidden />
        )}
        {recents
          .filter((r) => !isPinned(r))
          .map((ref) => (
            <button
              key={`recent-${ref}`}
              onClick={() => handleReferenceSearch(ref)}
              title={`Open ${ref} (recently viewed)`}
              className="h-7 px-2.5 rounded-full bg-surface-input border border-edge text-ink-dim hover:text-accent-hover hover:border-accent/50 cursor-pointer transition-colors duration-150 text-xs"
            >
              {ref}
            </button>
          ))}
      </div>

      {/* Output actions — sends need an open chapter; Clear is always
          reachable so the wall can be blanked from anywhere. Gated by role;
          the view-only guest gets none of them (Pin is local and stays). */}
      <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
        {selectedChapter && (role === 'media' || role === 'admin') && (
          <button
            onClick={handleSendToWall}
            disabled={wallState === 'sending'}
            title="Send the current passage to the Resolume wall (and display)"
            className="h-9 px-4 flex items-center gap-2 rounded-lg bg-accent-deep hover:bg-accent text-on-accent font-semibold text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent/10"
          >
            {wallState === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />}
            {wallState === 'sending' ? 'Sending…' : wallState === 'live' ? 'Update Wall' : 'Send to Wall'}
          </button>
        )}
        {selectedChapter && (role === 'worship' || role === 'admin') && (
          <button
            onClick={handleSendToDisplay}
            title="Send the current passage to the display window"
            className="h-9 px-4 rounded-lg border border-edge-strong text-ink-dim hover:text-ink hover:border-accent cursor-pointer text-sm font-medium"
          >
            Send to Display
          </button>
        )}
        {selectedChapter && currentReference && !PERMANENT_PINS.some((p) => p.ref === currentReference) && (
          <button
            onClick={() => togglePin(currentReference)}
            title={pins.some((p) => p.ref === currentReference) ? `Unpin ${currentReference}` : `Pin ${currentReference} for quick access`}
            className={`h-9 px-3 flex items-center gap-1.5 rounded-lg border cursor-pointer text-sm transition-colors duration-150 ${
              pins.some((p) => p.ref === currentReference)
                ? 'bg-accent/10 border-accent/40 text-accent-hover'
                : 'border-edge text-ink-mute hover:text-ink hover:border-accent/50'
            }`}
          >
            <PinIcon className="w-3.5 h-3.5" />
            {pins.some((p) => p.ref === currentReference) ? 'Pinned' : 'Pin'}
          </button>
        )}
        {(role === 'media' || role === 'admin') && (
          <button
            onClick={() => setShowWallLayout((v) => !v)}
            aria-pressed={showWallLayout}
            title="Adjust the Resolume wall box blur and size"
            className={`h-9 px-3 flex items-center gap-1.5 rounded-lg border cursor-pointer text-sm transition-colors duration-150 ${
              showWallLayout
                ? 'bg-accent/10 border-accent/40 text-accent-hover'
                : 'border-edge text-ink-mute hover:text-ink hover:border-accent/50'
            }`}
          >
            Wall layout
          </button>
        )}
        {role !== 'guest' && (selectedChapter || role === 'media' || role === 'admin') && (
          <span className="w-px h-5 bg-edge" aria-hidden />
        )}
        {role !== 'guest' && (
          <button
            onClick={handleClearWall}
            title="Clear scripture from all outputs (Esc)"
            className="h-9 px-3 rounded-lg border border-edge text-ink-mute hover:text-danger hover:border-danger/50 cursor-pointer text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {/* Errors — visible wherever the operator is, until dismissed */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="fade-swap flex items-start gap-3 bg-danger/10 border border-danger/30 rounded-lg px-4 py-2.5"
        >
          <p className="text-danger text-sm flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            title="Dismiss"
            className="p-1 rounded-md text-danger/70 hover:text-danger hover:bg-danger/10 cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Wall layout controls (media/admin) — live-adjust the Resolume boxes */}
      {showWallPanel && (
        <div className="fade-swap bg-surface-raised border border-edge rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider">Resolume wall boxes</div>
            <span className="text-xs text-ink-mute">{savingCfg ? 'Saving…' : 'Applies live'}</span>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-dim">Presets</div>
            {wallPresets.length === 0 ? (
              <p className="text-xs text-ink-mute">No presets yet</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {wallPresets.map((p) => {
                  const active = matchedPreset?.id === p.id;
                  return (
                    <span
                      key={p.id}
                      className={`inline-flex items-center rounded-lg border overflow-hidden transition-colors duration-150 ${
                        active
                          ? 'bg-accent/10 border-accent/40 text-accent-hover'
                          : 'border-edge text-ink-mute hover:border-accent/50'
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => applyPreset(p)}
                        className={`h-8 text-sm cursor-pointer transition-colors duration-150 ${
                          p.builtin ? 'px-3' : 'pl-3 pr-1'
                        } ${active ? '' : 'hover:text-ink'}`}
                      >
                        {p.name}
                      </button>
                      {!p.builtin && (
                        <button
                          type="button"
                          aria-label={`Delete ${p.name}`}
                          title={`Delete ${p.name}`}
                          onClick={() => handleDeletePreset(p)}
                          className="h-8 w-7 min-w-6 min-h-6 flex items-center justify-center text-ink-mute hover:text-danger cursor-pointer transition-colors duration-150"
                        >
                          <XIcon className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                maxLength={60}
                value={presetName}
                placeholder="Save as preset…"
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSavePreset(); } }}
                className="w-44 px-2.5 py-1.5 bg-surface-input text-ink text-sm border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={!presetName.trim()}
                className="h-8 px-3 rounded-lg border border-edge text-sm text-ink-mute hover:text-ink hover:border-accent/50 cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
              {selectedPreset && !presetMatches(selectedPreset, outputCfg) && (
                <button
                  type="button"
                  onClick={handleUpdatePreset}
                  className="text-xs text-accent hover:text-accent-hover cursor-pointer transition-colors duration-150"
                >
                  Update {selectedPreset.name}
                </button>
              )}
            </div>
            <p className="text-xs text-ink-mute">Saving an existing name overwrites it.</p>
          </div>
          <div>
            <div className="mb-1.5 text-sm text-ink-dim">Layout</div>
            <div className="inline-flex rounded-lg border border-edge overflow-hidden" role="group" aria-label="Wall layout">
              {([
                { value: 'imag', label: 'With IMAG' },
                { value: 'fullscreen', label: 'Fullscreen' },
              ] as { value: WallLayout; label: string }[]).map((opt) => {
                const active = outputCfg.layout === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { if (!active) saveOutputCfg({ ...outputCfg, layout: opt.value }); }}
                    className={`px-3 py-1.5 text-sm cursor-pointer transition-colors duration-150 ${
                      active ? 'bg-accent/10 text-accent-hover' : 'text-ink-mute hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-mute mt-1.5">
              {outputCfg.layout === 'fullscreen'
                ? 'Boxes split the full wall width with a small gap in the middle.'
                : 'Boxes sit either side, leaving the centre free for the IMAG camera.'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <label className="block">
              <div className="mb-1.5 text-sm text-ink-dim">Box width</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={6000} step={10}
                  {...boxInputProps('box_w_px')}
                  className="w-24 px-2.5 py-1.5 bg-surface-input text-ink text-sm border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-mute">px {outputCfg.box_w_px === 0 && '(auto)'}</span>
              </div>
              <p className="text-xs text-ink-mute mt-1">
                {outputCfg.layout === 'fullscreen'
                  ? '0 = auto (half the wall each). Each box extends in from its screen edge.'
                  : 'How far each box extends in from its screen edge.'}
              </p>
            </label>
            <label className="block">
              <div className="mb-1.5 text-sm text-ink-dim">Box height</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={6000} step={10}
                  {...boxInputProps('box_h_px')}
                  className="w-24 px-2.5 py-1.5 bg-surface-input text-ink text-sm border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-mute">px {outputCfg.box_h_px === 0 && '(auto)'}</span>
              </div>
              <p className="text-xs text-ink-mute mt-1">Box height, starting at the top of the IMAG band.</p>
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-dim">Text size</span>
                <span className="text-xs text-ink-mute tabular-nums">{Math.round(outputCfg.text_scale * 100)}%</span>
              </div>
              <input
                type="range" min={0.5} max={1} step={0.05}
                value={Math.min(1, outputCfg.text_scale)}
                onChange={(e) => queueOutputCfgSave({ ...outputCfg, text_scale: Number(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-ink-mute mt-1">
                Text already fills the box automatically — 100% is as large as it fits; lower it for
                more breathing room.
              </p>
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-dim">Blur</span>
                <span className="text-xs text-ink-mute tabular-nums">{outputCfg.blur}px</span>
              </div>
              <input
                type="range" min={0} max={40} step={1}
                value={outputCfg.blur}
                onChange={(e) => queueOutputCfgSave({ ...outputCfg, blur: Number(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-ink-mute mt-1">Frosts the video behind the box (may not render in OBS&apos;s browser source).</p>
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-dim">Fade</span>
                <span className="text-xs text-ink-mute tabular-nums">
                  {(outputCfg.fade_ms / 1000).toFixed(1)}s
                </span>
              </div>
              <input
                type="range" min={0} max={3000} step={100}
                value={outputCfg.fade_ms}
                onChange={(e) => queueOutputCfgSave({ ...outputCfg, fade_ms: Number(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-ink-mute mt-1">
                How long the boxes take to fade in on Send and out on Clear. Leave the Resolume clip
                connected at full opacity.
              </p>
            </label>
          </div>
          <button
            onClick={() => saveOutputCfg({ blur: 14, box_w_px: 0, box_h_px: 0, text_scale: 1, layout: 'imag', fade_ms: 600 })}
            className="text-xs text-ink-mute hover:text-ink cursor-pointer transition-colors duration-150"
          >
            Reset to defaults
          </button>
        </div>
      )}

      {/* Verse detected in the sermon captions — media/admin send via the pending-send-safe path */}
      {canDetect && verseDetect.detection && (
        <VerseDetectBanner
          key={verseDetect.detection.id}
          detection={verseDetect.detection}
          onSend={(p) => handleRef.current.lookupAndSend(p, 'wall')}
          onDismiss={() => verseDetect.dismiss(verseDetect.detection!.id)}
        />
      )}

      {/* Worship went live — media confirms the mirror (worship not on auto) */}
      {role === 'media' && suggestion && (
        <div className="fade-swap flex items-center gap-3 bg-live/10 border border-live/40 rounded-lg px-4 py-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse shrink-0" />
          <p className="text-sm text-ink flex-1">
            Worship is live with <span className="font-semibold text-accent-hover">{suggestion.reference}</span>
          </p>
          <button
            onClick={() => {
              seenSuggestionRef.current = suggestion.updated_at;
              applyMirror(suggestion.passage || suggestion.reference, suggestion.bibles);
              setSuggestion(null);
            }}
            title="Mirror to wall (Ctrl+Enter)"
            className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150"
          >
            Mirror to Wall
            <kbd className="ml-2 text-[10px] font-medium opacity-70">Ctrl↵</kbd>
          </button>
          <button
            onClick={() => { seenSuggestionRef.current = suggestion.updated_at; setSuggestion(null); }}
            aria-label="Dismiss"
            className="p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Media-team verse suggestion */}
      {role === 'worship' && suggestion && (
        <div className="fade-swap flex items-center gap-3 bg-accent/10 border border-accent/40 rounded-lg px-4 py-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
          <p className="text-sm text-ink flex-1">
            Media team suggests <span className="font-semibold text-accent-hover">{suggestion.reference}</span>
          </p>
          <button
            onClick={() => {
              seenSuggestionRef.current = suggestion.updated_at;
              handleReferenceSearch(suggestion.passage || suggestion.reference);
              setSuggestion(null);
            }}
            title="Accept suggestion (Ctrl+Enter)"
            className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150"
          >
            Accept
            <kbd className="ml-2 text-[10px] font-medium opacity-70">Ctrl↵</kbd>
          </button>
          <button
            onClick={() => { seenSuggestionRef.current = suggestion.updated_at; setSuggestion(null); }}
            aria-label="Dismiss suggestion"
            className="p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Breadcrumb */}
      {selectedBook && (
        <nav className="flex items-center gap-1.5 text-sm" aria-label="Bible navigation">
          <span
            className="text-ink-dim hover:text-ink cursor-pointer transition-colors duration-150"
            onClick={() => handleBreadcrumbClick('root')}
          >
            Books
          </span>
          <ChevronRightIcon className="w-3.5 h-3.5 text-ink-mute" />
          {selectedChapter ? (
            <>
              <span
                className="text-ink-dim hover:text-ink cursor-pointer transition-colors duration-150"
                onClick={() => handleBreadcrumbClick('book')}
              >
                {selectedBook.name}
              </span>
              <ChevronRightIcon className="w-3.5 h-3.5 text-ink-mute" />
              <span
                className={selection ? 'text-ink-dim hover:text-ink cursor-pointer transition-colors duration-150' : 'text-ink font-medium'}
                onClick={selection ? handleShowFullChapter : undefined}
                title={selection ? 'Show full chapter' : undefined}
              >
                Chapter {selectedChapter.number}
              </span>
            </>
          ) : (
            <span className="text-ink font-medium">{selectedBook.name}</span>
          )}
        </nav>
      )}

      {/* Main content: books browse full-width until a book is chosen, then
          the book list docks to a sidebar next to the scripture. */}
      <div className="flex gap-4">
        {selectedBook && (
          <div className="w-[210px] flex-shrink-0 hidden md:block">
            <BookList
              books={books}
              selectedBookId={selectedBook.id}
              onSelectBook={handleSelectBook}
              isLoading={isLoadingBooks}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!selectedBook && !isLoadingBooks && (
            /* Full-width books browser: OT and NT side-by-side so all 66
               books fit in one viewport without scrolling. */
            <div className="bg-surface-raised rounded-xl border border-edge p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <BookOpenIcon className="w-4 h-4 text-accent-hover" />
                  <h2 className="text-sm font-semibold text-ink">Books</h2>
                </div>
                <div data-enter-sends className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-mute mr-1 hidden sm:inline">Quick jump:</span>
                  {['John 3:16', 'Psalm 23', 'Romans 8:28', '1 Cor 13:4-7'].map((ref) => (
                    <button
                      key={ref}
                      onClick={() => handleReferenceSearch(ref)}
                      className="h-7 px-2.5 rounded-full bg-surface-input border border-edge text-ink-dim hover:text-accent-hover hover:border-accent/50 cursor-pointer transition-colors duration-150 text-xs"
                    >
                      {ref}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
                {[
                  { title: 'Old Testament', list: books.slice(0, 39) },
                  { title: 'New Testament', list: books.slice(39) },
                ].map(({ title, list }) =>
                  list.length === 0 ? null : (
                    <div key={title}>
                      <h3 className="text-[10px] font-semibold text-ink-mute uppercase tracking-widest mb-2 pb-1.5 border-b border-edge/60">
                        {title}
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-1">
                        {list.map((book) => (
                          <button
                            key={book.id}
                            onClick={() => handleSelectBook(book)}
                            title={book.name}
                            className="h-8 px-2 rounded-md text-left text-xs truncate bg-surface-input border border-edge text-ink-dim hover:border-accent/60 hover:text-ink cursor-pointer transition-colors duration-150"
                          >
                            {book.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {isLoadingBooks && (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
              <span className="text-sm text-ink-mute">Loading...</span>
            </div>
          )}

          {selectedBook && !selectedChapter && !isLoadingChapters && (
            <div data-enter-sends>
              <ChapterGrid
                chapters={chapters}
                selectedChapterId={null}
                onSelectChapter={handleSelectChapter}
                bookName={selectedBook.name}
                isLoading={isLoadingChapters}
              />
            </div>
          )}

          {isLoadingChapters && (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
              <span className="text-sm text-ink-mute">Loading...</span>
            </div>
          )}

          {selectedChapter && (
            <>
              {!isLoadingContent && verseNumbers.length > 0 && (
                <div data-enter-sends>
                  <VerseGrid
                    verseNumbers={verseNumbers}
                    selectedVerse={selectedVerse}
                    onSelectVerse={handleSelectVerse}
                    onShowFullChapter={handleShowFullChapter}
                  />
                </div>
              )}
              {/* Phones: translations stack. md+: side by side, scrolling past 260px each. */}
              <div className="md:overflow-x-auto">
                <div
                  className="grid grid-cols-1 gap-4 md:[grid-template-columns:var(--verse-cols)]"
                  style={{
                    '--verse-cols': `repeat(${selectedBibleIds.length}, minmax(260px, 1fr))`,
                  } as React.CSSProperties}
                >
                  {selectedBibleIds.map((id) => {
                    const t = translations.find((x) => x.id === id);
                    const full = fullChapters[id]?.content;
                    if (!isLoadingContent && fullChapters[id] === undefined) {
                      // Column fetch in flight (newly added translation).
                      return (
                        <div key={id} className="bg-surface-raised rounded-xl border border-edge p-4 flex items-center justify-center py-12">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
                          <span className="text-sm text-ink-mute">Loading...</span>
                        </div>
                      );
                    }
                    if (!isLoadingContent && full === '') {
                      return (
                        <div key={id} className="bg-surface-raised rounded-xl border border-edge overflow-hidden">
                          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-edge bg-surface-sunken/50">
                            <span className="px-2 py-0.5 rounded-md bg-surface-hover text-ink-mute text-[11px] font-bold tracking-wide uppercase">
                              {t?.abbreviation || 'Translation'}
                            </span>
                          </div>
                          <p className="text-sm text-ink-mute px-4 py-6 text-center">
                            Not available in this translation.
                          </p>
                        </div>
                      );
                    }
                    const content = renderSelection(full || '', selection);
                    // Each column shows its own translation's localized
                    // reference (e.g. "യോഹന്നാൻ 3:16" for MOV).
                    const baseRef =
                      fullChapters[id]?.reference ||
                      `${selectedBook!.name} ${selectedChapter.number}`;
                    const ref = referenceString(baseRef, selection);
                    return (
                      <VerseDisplay
                        key={id}
                        reference={ref}
                        content={content}
                        translationAbbreviation={t?.abbreviation || ''}
                        isLoading={isLoadingContent}
                        error={null}
                        indic={INDIC_LANGS.has(t?.language?.id || '')}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

export default forwardRef<BiblePanelHandle, {}>(BiblePanel);
