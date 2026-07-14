'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  bibleApi,
  liveApi,
  BibleTranslation,
  BibleBook,
  BibleChapter,
  OutputConfig,
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
import { PlusIcon, XIcon, ChevronRightIcon, BookOpenIcon, PinIcon } from '@/components/icons';

// Language ids whose scripts need taller line boxes (stacked conjuncts).
const INDIC_LANGS = new Set(['mal', 'hin', 'tam', 'tel', 'kan']);

const MAX_COLUMNS = 4;

// Per-column chapter payload; empty content marks "not available here".
interface ChapterData {
  content: string;
  reference: string;
}

export default function BiblePanel() {
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

  // 1. On mount: fetch translations, default to KJV + MOV.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingTranslations(true);
        const data = await bibleApi.getBibles();
        if (cancelled) return;
        setTranslations(data);

        const kjv =
          data.find((t) => t.id === 'local-kjv') ||
          data.find((t) => t.id === 'de4e12af7f28f599-02') ||
          data.find((t) => t.abbreviation === 'engKJV');
        const mov =
          data.find((t) => t.id === 'local-mal-ov') ||
          data.find((t) => t.language?.id === 'mal');

        const defaults = [kjv?.id, mov?.id].filter(Boolean) as string[];
        if (defaults.length === 0 && data.length > 0) defaults.push(data[0].id);
        setSelectedBibleIds(defaults);
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
      // Prefer a reliable full-canon default (api.bible KJV), then any unused.
      const unused =
        translations.find((t) => t.id === 'de4e12af7f28f599-02' && !prev.includes(t.id)) ||
        translations.find((t) => !prev.includes(t.id));
      return unused ? [...prev, unused.id] : prev;
    });
  }, [translations]);

  // Navigation handlers -----------------------------------------------------
  const handleSelectBook = useCallback((book: BibleBook) => {
    setSelectedBook(book);
    setSelectedChapter(null);
    setSelection(null);
    setFullChapters({});
  }, []);

  const handleSelectChapter = useCallback((chapter: BibleChapter) => {
    setSelectedChapter(chapter);
    setSelection(null);
  }, []);

  const handleSelectVerse = useCallback((verseNumber: string) => {
    const n = Number(verseNumber);
    setSelection({ start: n, end: n });
  }, []);

  const handleShowFullChapter = useCallback(() => {
    setSelection(null);
  }, []);

  const handleReferenceSearch = useCallback(async (reference: string) => {
    const trimmed = reference.trim();
    if (!trimmed) return;

    // Normalize separators so "gen 1 20", "gen 1:20", "gen 1 : 20", and
    // "gen 1 20-25" / "gen 1 20 25" all parse the same way.
    const normalized = trimmed
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*/g, ':')
      .replace(/\s*-\s*/g, '-');

    // [\p{L}\p{M}] accepts non-Latin book names — Indic scripts need \p{M}
    // for combining vowel signs/conjuncts (e.g. യോഹന്നാൻ).
    // chapter[:| ]verse[-| ]endVerse — colon and space are interchangeable.
    const match = normalized.match(/^(\d? ?[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*) (\d+)(?:[: ](\d+)(?:[- ](\d+))?)?$/u);
    if (!match) {
      setError('Reference not found. Try John 3:16, Gen 1 20, or Gen 1:1-5.');
      return;
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
        name === bookQuery || name.startsWith(bookQuery) ||
        nameLong === bookQuery || nameLong.startsWith(bookQuery) ||
        abbr === bookQuery
      );
    });
    if (!matchedBook) {
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
      return;
    }

    try {
      setError(null);
      const chaptersData = await bibleApi.getChapters(primaryBibleId, matchedBook.id);
      const matchedChapter = chaptersData.find((c) => c.number === chapterNum);
      if (!matchedChapter) {
        setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
        return;
      }
      setChapters(chaptersData);
      setSelectedBook(matchedBook);
      setSelectedChapter(matchedChapter);
      if (startVerse) {
        setSelection({ start: Number(startVerse), end: Number(endVerse || startVerse) });
      } else {
        setSelection(null);
      }
    } catch (err) {
      console.error('Error searching reference:', err);
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
    }
  }, [books, primaryBibleId]);

  const handleBreadcrumbClick = useCallback((level: 'root' | 'book') => {
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
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    try { setRecents(JSON.parse(localStorage.getItem('bible-recents') || '[]')); } catch {}
    try { setPins(JSON.parse(localStorage.getItem('bible-pins') || '[]')); } catch {}
  }, []);

  // Wall-output layout (blur + box size) — media/admin adjustable, persisted
  // server-side and applied live on the Resolume/OBS capture page.
  type WallCfg = { blur: number; box_w_px: number; box_h_px: number; text_scale: number };
  const [outputCfg, setOutputCfg] = useState<WallCfg>({ blur: 14, box_w_px: 0, box_h_px: 0, text_scale: 1 });
  const [showWallLayout, setShowWallLayout] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  useEffect(() => {
    liveApi.getOutputConfig()
      .then((c) => setOutputCfg({ blur: c.blur, box_w_px: c.box_w_px, box_h_px: c.box_h_px, text_scale: c.text_scale }))
      .catch(() => {});
  }, []);
  const saveOutputCfg = useCallback((next: WallCfg) => {
    setOutputCfg(next);
    setSavingCfg(true);
    liveApi.setOutputConfig(next).catch(() => {}).finally(() => setSavingCfg(false));
  }, []);

  // Human-readable reference of what is currently on screen, e.g. "John 3:16-18".
  const currentReference = useMemo(() => {
    if (!selectedBook || !selectedChapter) return null;
    let ref = `${selectedBook.name} ${selectedChapter.number}`;
    if (selection) {
      ref += `:${selection.start}${selection.end !== selection.start ? `-${selection.end}` : ''}`;
    }
    return ref;
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
      const next = prev.includes(ref) ? prev.filter((r) => r !== ref) : [ref, ...prev].slice(0, 12);
      try { localStorage.setItem('bible-pins', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Team role: media proposes verses, worship gets an accept prompt.
  const [role, setRole] = useState<'media' | 'worship' | 'admin'>('worship');
  useEffect(() => {
    const saved = localStorage.getItem('sat-role');
    if (saved === 'media' || saved === 'worship' || saved === 'admin') setRole(saved);
  }, []);

  const [suggestion, setSuggestion] = useState<{ reference: string; updated_at: number; bibles?: string[] } | null>(null);
  const seenSuggestionRef = useRef<number>(0);

  // Media: mirror what worship sends to live. Auto = follow and send to the
  // wall immediately; off = show a confirmation banner first.
  const [autoMirror, setAutoMirror] = useState(true);
  useEffect(() => {
    const v = localStorage.getItem('bible-auto-mirror');
    if (v !== null) setAutoMirror(v === '1');
  }, []);
  const toggleAutoMirror = () => {
    setAutoMirror((v) => {
      localStorage.setItem('bible-auto-mirror', v ? '0' : '1');
      return !v;
    });
  };

  // When set, send to the wall as soon as the navigated chapter's content is
  // loaded (mirroring navigates first, then data arrives async).
  const pendingWallSendRef = useRef(false);
  // Marks the next wall send as mirror-triggered (suppresses re-publishing).
  const mirrorSendRef = useRef(false);
  // What this screen is currently showing, for the same-verse guard below.
  const currentReferenceRef = useRef<string | null>(null);
  currentReferenceRef.current = currentReference;

  // Mirror worship's passage AND translation columns, then queue the wall send.
  const applyMirror = useCallback((reference: string, bibles?: string[]) => {
    if (bibles && bibles.length > 0) {
      const valid = bibles.filter((id) => translations.some((t) => t.id === id)).slice(0, MAX_COLUMNS);
      if (valid.length > 0) {
        setSelectedBibleIds((prev) =>
          prev.length === valid.length && prev.every((id, i) => id === valid[i]) ? prev : valid
        );
      }
    }
    pendingWallSendRef.current = true;
    handleReferenceSearch(reference);
  }, [translations, handleReferenceSearch]);

  // Both teams poll the shared suggestion channel, each listening only for
  // the other side: worship hears media's proposals, media hears what
  // worship took live.
  useEffect(() => {
    const listenFor = role === 'worship' ? 'media' : role === 'media' ? 'worship' : null;
    if (!listenFor) return;
    if (seenSuggestionRef.current === 0) seenSuggestionRef.current = Date.now();
    const id = setInterval(async () => {
      try {
        const sug = await liveApi.getSuggestion();
        if (!sug.reference || sug.updated_at <= seenSuggestionRef.current) return;
        if ((sug.from || 'media') !== listenFor) return;
        // Same verse we're already showing (e.g. our own live verse echoed
        // back through the other side): acknowledge silently.
        if (sug.reference === currentReferenceRef.current) {
          seenSuggestionRef.current = sug.updated_at;
          return;
        }
        if (role === 'media' && autoMirror) {
          seenSuggestionRef.current = sug.updated_at;
          applyMirror(sug.reference, sug.bibles);
        } else {
          setSuggestion({ reference: sug.reference, updated_at: sug.updated_at, bibles: sug.bibles });
        }
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [role, autoMirror, applyMirror]);

  // Enter accepts a pending suggestion banner (worship: open it; media:
  // mirror it to the wall), skipped while typing in a field.
  useEffect(() => {
    if (!suggestion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      seenSuggestionRef.current = suggestion.updated_at;
      if (role === 'media') applyMirror(suggestion.reference, suggestion.bibles);
      else handleReferenceSearch(suggestion.reference);
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
  const handleSendToWall = useCallback(async () => {
    if (!selectedChapter) return;
    const columns = buildScriptureColumns();
    // A wall send triggered by mirroring worship must not re-publish a media
    // suggestion — that would echo worship's own verse back to them.
    const isMirrorSend = mirrorSendRef.current;
    mirrorSendRef.current = false;

    try {
      setWallState('sending');
      await liveApi.setScripture(columns);
      displayChannelRef.current?.postMessage({ type: 'scripture', columns });
      if (role === 'media' && columns[0] && !isMirrorSend) {
        liveApi.setSuggestion(columns[0].reference, 'media').catch(() => {});
      }
      setWallState('live');
    } catch (err) {
      console.error('Error sending scripture to wall:', err);
      setWallState('idle');
      setError('Could not send to the wall output. Check the backend connection.');
    }
  }, [selectedChapter, buildScriptureColumns, role]);

  // Send the current selection to the same-machine /display window. When
  // worship takes a verse live, publish it so the media machine can mirror.
  const handleSendToDisplay = useCallback(() => {
    const columns = buildScriptureColumns();
    if (columns.length === 0) return;
    displayChannelRef.current?.postMessage({ type: 'scripture', columns });
    if (role === 'worship' && columns[0]) {
      liveApi.setSuggestion(columns[0].reference, 'worship', selectedBibleIds).catch(() => {});
    }
  }, [buildScriptureColumns, role, selectedBibleIds]);

  // Complete a pending mirror: once the navigated chapter's content arrives,
  // push it to the wall automatically.
  useEffect(() => {
    if (!pendingWallSendRef.current || !selectedChapter) return;
    if (!fullChapters[primaryBibleId]?.content) return;
    pendingWallSendRef.current = false;
    mirrorSendRef.current = true;
    handleSendToWall();
  }, [fullChapters, selectedChapter, primaryBibleId, handleSendToWall]);

  const handleClearWall = useCallback(async () => {
    displayChannelRef.current?.postMessage({ type: 'scripture-clear' });
    try {
      await liveApi.clearScripture();
      setWallState('idle');
    } catch (err) {
      console.error('Error clearing wall:', err);
    }
  }, []);


  // Derived -----------------------------------------------------------------
  const verseNumbers = useMemo(
    () => verseNumbersOf(fullChapters[primaryBibleId]?.content || ''),
    [fullChapters, primaryBibleId]
  );
  const selectedVerse =
    selection && selection.start === selection.end ? String(selection.start) : null;

  // Cross-boundary stepping: which verse/chapter to land on once data loads.
  const pendingVerseRef = useRef<'first' | 'last' | null>(null);
  const pendingChapterRef = useRef<'first' | 'last' | null>(null);

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

  // Arrow keys step verses, flowing across chapter and book boundaries.
  useEffect(() => {
    const step = (dir: 1 | -1) => {
      if (!selection || selection.start !== selection.end) return;
      const idx = verseNumbers.indexOf(String(selection.start));
      if (idx === -1) return;
      const next = idx + dir;
      if (next >= 0 && next < verseNumbers.length) {
        const n = Number(verseNumbers[next]);
        setSelection({ start: n, end: n });
        return;
      }
      // Chapter boundary
      if (!selectedChapter) return;
      const cIdx = chapters.findIndex((c) => c.id === selectedChapter.id);
      const nextChapter = chapters[cIdx + dir];
      if (nextChapter) {
        pendingVerseRef.current = dir === 1 ? 'first' : 'last';
        setSelection(null);
        setSelectedChapter(nextChapter);
        return;
      }
      // Book boundary
      if (!selectedBook) return;
      const bIdx = books.findIndex((b) => b.id === selectedBook.id);
      const nextBook = books[bIdx + dir];
      if (!nextBook) return;
      pendingChapterRef.current = dir === 1 ? 'first' : 'last';
      pendingVerseRef.current = dir === 1 ? 'first' : 'last';
      setSelection(null);
      setSelectedChapter(null);
      setSelectedBook(nextBook);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, verseNumbers, chapters, selectedChapter, books, selectedBook]);

  return (
    <div className="px-4 sm:px-6 py-5 space-y-4">
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
          {role === 'media' && (
            <button
              onClick={toggleAutoMirror}
              role="switch"
              aria-checked={autoMirror}
              title={
                autoMirror
                  ? 'Verses worship takes live are sent to the wall automatically. Click to require confirmation instead.'
                  : 'Verses worship takes live show a confirmation prompt first. Click to mirror automatically.'
              }
              className={`h-9 px-3 flex items-center gap-2 rounded-lg border cursor-pointer text-sm font-medium transition-colors duration-150 ${
                autoMirror
                  ? 'bg-ok/10 border-ok/40 text-ok'
                  : 'bg-surface-input border-edge text-ink-dim hover:text-ink hover:border-edge-strong'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoMirror ? 'bg-ok animate-pulse' : 'bg-edge-strong'}`} />
              {autoMirror ? 'Auto-mirror' : 'Mirror: confirm'}
            </button>
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

      {/* Pinned + recent passages */}
      {(pins.length > 0 || recents.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pins.map((ref) => (
            <span
              key={`pin-${ref}`}
              className="group flex items-center rounded-full bg-accent/10 border border-accent/40 overflow-hidden"
            >
              <button
                onClick={() => handleReferenceSearch(ref)}
                title={`Open ${ref}`}
                className="h-7 pl-2.5 pr-1.5 flex items-center gap-1.5 text-accent-hover hover:text-ink cursor-pointer transition-colors duration-150 text-xs font-medium"
              >
                <PinIcon className="w-3 h-3" />
                {ref}
              </button>
              <button
                onClick={() => togglePin(ref)}
                title="Unpin"
                aria-label={`Unpin ${ref}`}
                className="h-7 pr-2 pl-0.5 flex items-center text-accent-hover/50 hover:text-danger cursor-pointer transition-colors duration-150"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
          {pins.length > 0 && recents.filter((r) => !pins.includes(r)).length > 0 && (
            <span className="w-px h-4 bg-edge mx-0.5" aria-hidden />
          )}
          {recents
            .filter((r) => !pins.includes(r))
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
      )}

      {/* Output actions — visible once a chapter is open, gated by role */}
      {selectedChapter && (
        <div className="flex items-center justify-end gap-2">
          {(role === 'media' || role === 'admin') && (
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
          {(role === 'worship' || role === 'admin') && (
            <button
              onClick={handleSendToDisplay}
              title="Send the current passage to the display window"
              className="h-9 px-4 rounded-lg border border-edge-strong text-ink-dim hover:text-ink hover:border-accent cursor-pointer text-sm font-medium"
            >
              Send to Display
            </button>
          )}
          {currentReference && (
            <button
              onClick={() => togglePin(currentReference)}
              title={pins.includes(currentReference) ? `Unpin ${currentReference}` : `Pin ${currentReference} for quick access`}
              className={`h-9 px-3 flex items-center gap-1.5 rounded-lg border cursor-pointer text-sm transition-colors duration-150 ${
                pins.includes(currentReference)
                  ? 'bg-accent/10 border-accent/40 text-accent-hover'
                  : 'border-edge text-ink-mute hover:text-ink hover:border-accent/50'
              }`}
            >
              <PinIcon className="w-3.5 h-3.5" />
              {pins.includes(currentReference) ? 'Pinned' : 'Pin'}
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
          <span className="w-px h-5 bg-edge" aria-hidden />
          <button
            onClick={handleClearWall}
            title="Clear scripture from all outputs"
            className="h-9 px-3 rounded-lg border border-edge text-ink-mute hover:text-danger hover:border-danger/50 cursor-pointer text-sm"
          >
            Clear
          </button>
        </div>
      )}

      {/* Wall layout controls (media/admin) — live-adjust the Resolume boxes */}
      {(role === 'media' || role === 'admin') && showWallLayout && (
        <div className="fade-swap bg-surface-raised border border-edge rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider">Resolume wall boxes</div>
            <span className="text-xs text-ink-mute">{savingCfg ? 'Saving…' : 'Applies live'}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <label className="block">
              <div className="mb-1.5 text-sm text-ink-dim">Box width</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={6000} step={10}
                  value={outputCfg.box_w_px}
                  onChange={(e) => saveOutputCfg({ ...outputCfg, box_w_px: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-24 px-2.5 py-1.5 bg-surface-input text-ink text-sm border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-mute">px {outputCfg.box_w_px === 0 && '(auto)'}</span>
              </div>
              <p className="text-xs text-ink-mute mt-1">How far each box extends in from its screen edge.</p>
            </label>
            <label className="block">
              <div className="mb-1.5 text-sm text-ink-dim">Box height</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={6000} step={10}
                  value={outputCfg.box_h_px}
                  onChange={(e) => saveOutputCfg({ ...outputCfg, box_h_px: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-24 px-2.5 py-1.5 bg-surface-input text-ink text-sm border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-mute">px {outputCfg.box_h_px === 0 && '(auto)'}</span>
              </div>
              <p className="text-xs text-ink-mute mt-1">Box height, centered in the IMAG band.</p>
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-dim">Text size</span>
                <span className="text-xs text-ink-mute tabular-nums">{Math.round(outputCfg.text_scale * 100)}%</span>
              </div>
              <input
                type="range" min={0.5} max={2} step={0.05}
                value={outputCfg.text_scale}
                onChange={(e) => saveOutputCfg({ ...outputCfg, text_scale: Number(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-ink-mute mt-1">Text auto-fits the box; this nudges it up or down.</p>
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-dim">Blur</span>
                <span className="text-xs text-ink-mute tabular-nums">{outputCfg.blur}px</span>
              </div>
              <input
                type="range" min={0} max={40} step={1}
                value={outputCfg.blur}
                onChange={(e) => saveOutputCfg({ ...outputCfg, blur: Number(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-ink-mute mt-1">Frosts the video behind the box (may not render in OBS&apos;s browser source).</p>
            </label>
          </div>
          <button
            onClick={() => saveOutputCfg({ blur: 14, box_w_px: 0, box_h_px: 0, text_scale: 1 })}
            className="text-xs text-ink-mute hover:text-ink cursor-pointer transition-colors duration-150"
          >
            Reset to defaults
          </button>
        </div>
      )}

      {/* Worship went live — media confirms the mirror (auto-mirror off) */}
      {role === 'media' && suggestion && (
        <div className="fade-swap flex items-center gap-3 bg-live/10 border border-live/40 rounded-lg px-4 py-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse shrink-0" />
          <p className="text-sm text-ink flex-1">
            Worship is live with <span className="font-semibold text-accent-hover">{suggestion.reference}</span>
          </p>
          <button
            onClick={() => {
              seenSuggestionRef.current = suggestion.updated_at;
              applyMirror(suggestion.reference, suggestion.bibles);
              setSuggestion(null);
            }}
            title="Mirror to wall (Enter)"
            className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150"
          >
            Mirror to Wall ↵
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
              handleReferenceSearch(suggestion.reference);
              setSuggestion(null);
            }}
            title="Accept suggestion (Enter)"
            className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150"
          >
            Accept ↵
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
                <div className="flex flex-wrap items-center gap-1.5">
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
            <ChapterGrid
              chapters={chapters}
              selectedChapterId={null}
              onSelectChapter={handleSelectChapter}
              bookName={selectedBook.name}
              isLoading={isLoadingChapters}
            />
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
                <VerseGrid
                  verseNumbers={verseNumbers}
                  selectedVerse={selectedVerse}
                  onSelectVerse={handleSelectVerse}
                  onShowFullChapter={handleShowFullChapter}
                />
              )}
              <div className="overflow-x-auto">
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${selectedBibleIds.length}, minmax(260px, 1fr))`,
                  }}
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

          {error && !selectedChapter && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mt-4">
              <p className="text-danger text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
