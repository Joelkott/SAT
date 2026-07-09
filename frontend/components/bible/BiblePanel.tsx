'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  bibleApi,
  liveApi,
  BibleTranslation,
  BibleBook,
  BibleChapter,
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
import { PlusIcon, XIcon, ChevronRightIcon, BookOpenIcon } from '@/components/icons';

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

  // Wall output -------------------------------------------------------------
  const [wallState, setWallState] = useState<'idle' | 'sending' | 'live'>('idle');

  // Send the current selection to the LED-wall output page via the backend.
  // Wall sides are fixed by language: LEFT = English, RIGHT = Malayalam,
  // regardless of the column order in the control window.
  const handleSendToWall = useCallback(async () => {
    if (!selectedChapter) return;
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
    if (candidates.length === 0) return;

    const english = candidates.find((c) => c.langId === 'eng');
    const malayalam = candidates.find((c) => c.langId === 'mal');
    const left = english || candidates.find((c) => c !== malayalam) || candidates[0];
    const right = malayalam || candidates.find((c) => c !== left) || left;
    const columns = [left.column, right.column];

    try {
      setWallState('sending');
      await liveApi.setScripture(columns);
      setWallState('live');
    } catch (err) {
      console.error('Error sending scripture to wall:', err);
      setWallState('idle');
      setError('Could not send to the wall output. Check the backend connection.');
    }
  }, [selectedChapter, selectedBibleIds, translations, fullChapters, selection]);

  const handleClearWall = useCallback(async () => {
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

        <div className="hidden lg:block w-px self-stretch bg-edge" aria-hidden />

        {/* LED wall output controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSendToWall}
            disabled={!selectedChapter || wallState === 'sending'}
            title="Send the current passage to the /output/bible wall page"
            className="h-9 px-4 flex items-center gap-2 rounded-lg bg-accent-deep hover:bg-accent text-on-accent font-semibold text-sm cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {wallState === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />}
            {wallState === 'sending' ? 'Sending…' : wallState === 'live' ? 'Update Wall' : 'Send to Wall'}
          </button>
          <button
            onClick={handleClearWall}
            title="Clear scripture from the wall output"
            className="h-9 px-3 rounded-lg border border-edge text-ink-mute hover:text-danger hover:border-danger/50 cursor-pointer transition-colors duration-150 text-sm"
          >
            Clear
          </button>
        </div>
      </div>

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
