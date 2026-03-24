'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  bibleApi,
  BibleTranslation,
  BibleBook,
  BibleChapter,
  BibleChapterContent,
} from '@/lib/api';
import TranslationSelector from '@/components/bible/TranslationSelector';
import BookList from '@/components/bible/BookList';
import ChapterGrid from '@/components/bible/ChapterGrid';
import VerseDisplay from '@/components/bible/VerseDisplay';
import ReferenceSearch from '@/components/bible/ReferenceSearch';

export default function BiblePanel() {
  // Data
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [selectedBibleId, setSelectedBibleId] = useState<string>('');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [chapters, setChapters] = useState<BibleChapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<BibleChapter | null>(null);
  const [chapterContent, setChapterContent] = useState<BibleChapterContent | null>(null);

  // Loading states
  const [isLoadingTranslations, setIsLoadingTranslations] = useState(true);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // 1. On mount: fetch translations
  useEffect(() => {
    let cancelled = false;
    const fetchTranslations = async () => {
      try {
        setIsLoadingTranslations(true);
        const data = await bibleApi.getBibles();
        if (cancelled) return;
        setTranslations(data);
        if (data.length > 0) {
          setSelectedBibleId(data[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading translations:', err);
        setError('No Bible translations available. Check the API configuration.');
      } finally {
        if (!cancelled) setIsLoadingTranslations(false);
      }
    };
    fetchTranslations();
    return () => { cancelled = true; };
  }, []);

  // 2. When selectedBibleId changes: fetch books
  useEffect(() => {
    if (!selectedBibleId) return;
    let cancelled = false;
    const fetchBooks = async () => {
      try {
        setIsLoadingBooks(true);
        setSelectedBook(null);
        setChapters([]);
        setSelectedChapter(null);
        setChapterContent(null);
        setError(null);
        const data = await bibleApi.getBooks(selectedBibleId);
        if (cancelled) return;
        setBooks(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading books:', err);
        setError('Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingBooks(false);
      }
    };
    fetchBooks();
    return () => { cancelled = true; };
  }, [selectedBibleId]);

  // 3. When selectedBook changes: fetch chapters
  useEffect(() => {
    if (!selectedBook) return;
    let cancelled = false;
    const fetchChapters = async () => {
      try {
        setIsLoadingChapters(true);
        setSelectedChapter(null);
        setChapterContent(null);
        setError(null);
        const data = await bibleApi.getChapters(selectedBibleId, selectedBook.id);
        if (cancelled) return;
        setChapters(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading chapters:', err);
        setError('Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingChapters(false);
      }
    };
    fetchChapters();
    return () => { cancelled = true; };
  }, [selectedBook, selectedBibleId]);

  // 4. When selectedChapter changes: fetch chapter content
  useEffect(() => {
    if (!selectedChapter) return;
    let cancelled = false;
    const fetchContent = async () => {
      try {
        setIsLoadingContent(true);
        setError(null);
        const data = await bibleApi.getChapter(selectedBibleId, selectedChapter.id);
        if (cancelled) return;
        setChapterContent(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading chapter content:', err);
        setError('Could not load scripture. Check your connection and try again.');
      } finally {
        if (!cancelled) setIsLoadingContent(false);
      }
    };
    fetchContent();
    return () => { cancelled = true; };
  }, [selectedChapter, selectedBibleId]);

  // Handlers
  const handleSelectTranslation = useCallback((bibleId: string) => {
    setSelectedBibleId(bibleId);
  }, []);

  const handleSelectBook = useCallback((book: BibleBook) => {
    setSelectedBook(book);
  }, []);

  const handleSelectChapter = useCallback((chapter: BibleChapter) => {
    setSelectedChapter(chapter);
  }, []);

  const handleReferenceSearch = useCallback(async (reference: string) => {
    const trimmed = reference.trim();
    if (!trimmed) return;

    // Parse reference: "John 3:16", "1 Cor 13:4-7", "Genesis 1"
    const match = trimmed.match(/^(\d?\s*[A-Za-z]+)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!match) {
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
      return;
    }

    const bookQuery = match[1].trim().toLowerCase();
    const chapterNum = match[2];
    const startVerse = match[3];
    const endVerse = match[4];

    // Find matching book
    const matchedBook = books.find((b) => {
      const name = b.name.toLowerCase();
      const abbr = b.abbreviation.toLowerCase();
      return name === bookQuery || name.startsWith(bookQuery) || abbr === bookQuery;
    });

    if (!matchedBook) {
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
      return;
    }

    // Construct passage ID
    let passageId: string;
    if (startVerse && endVerse) {
      passageId = `${matchedBook.id}.${chapterNum}.${startVerse}-${matchedBook.id}.${chapterNum}.${endVerse}`;
    } else if (startVerse) {
      passageId = `${matchedBook.id}.${chapterNum}.${startVerse}`;
    } else {
      passageId = `${matchedBook.id}.${chapterNum}`;
    }

    try {
      setIsLoadingContent(true);
      setError(null);
      setSelectedBook(matchedBook);

      // Fetch chapters for breadcrumb context
      const chaptersData = await bibleApi.getChapters(selectedBibleId, matchedBook.id);
      setChapters(chaptersData);
      const matchedChapter = chaptersData.find((c) => c.number === chapterNum);
      if (matchedChapter) {
        setSelectedChapter(matchedChapter);
      }

      const passage = await bibleApi.getPassage(selectedBibleId, passageId);
      setChapterContent({
        id: passage.id,
        bibleId: passage.bibleId,
        bookId: matchedBook.id,
        number: chapterNum,
        reference: passage.reference,
        content: passage.content,
      });
    } catch (err) {
      console.error('Error searching reference:', err);
      setError('Reference not found. Try a format like John 3:16 or Gen 1:1-5.');
    } finally {
      setIsLoadingContent(false);
    }
  }, [books, selectedBibleId]);

  const handleBreadcrumbClick = useCallback((level: 'root' | 'book') => {
    if (level === 'root') {
      setSelectedBook(null);
      setSelectedChapter(null);
      setChapterContent(null);
      setChapters([]);
      setError(null);
    } else if (level === 'book') {
      setSelectedChapter(null);
      setChapterContent(null);
      setError(null);
    }
  }, []);

  const handleRetry = useCallback(() => {
    // Re-trigger the last fetch by resetting and re-setting state
    if (selectedChapter) {
      const chapter = selectedChapter;
      setSelectedChapter(null);
      setTimeout(() => setSelectedChapter(chapter), 0);
    } else if (selectedBook) {
      const book = selectedBook;
      setSelectedBook(null);
      setTimeout(() => setSelectedBook(book), 0);
    }
  }, [selectedBook, selectedChapter]);

  const currentTranslation = translations.find((t) => t.id === selectedBibleId);

  return (
    <div className="px-6 py-6 space-y-4">
      {/* Top row: Translation Selector + Reference Search */}
      <div className="flex gap-4 items-start">
        <div className="w-64">
          <TranslationSelector
            translations={translations}
            selectedId={selectedBibleId}
            onSelect={handleSelectTranslation}
            isLoading={isLoadingTranslations}
          />
        </div>
        <div className="flex-1">
          <ReferenceSearch
            onSearch={handleReferenceSearch}
            isLoading={isLoadingContent}
          />
        </div>
      </div>

      {/* Breadcrumb -- show when a book or chapter is selected */}
      {selectedBook && (
        <div className="text-sm text-gray-400">
          <span
            className="text-gray-300 hover:text-gray-100 cursor-pointer"
            onClick={() => handleBreadcrumbClick('root')}
          >
            Books
          </span>
          <span className="text-gray-500"> &gt; </span>
          {selectedChapter ? (
            <>
              <span
                className="text-gray-300 hover:text-gray-100 cursor-pointer"
                onClick={() => handleBreadcrumbClick('book')}
              >
                {selectedBook.name}
              </span>
              <span className="text-gray-500"> &gt; </span>
              <span className="text-gray-100">Chapter {selectedChapter.number}</span>
            </>
          ) : (
            <span className="text-gray-100">{selectedBook.name}</span>
          )}
        </div>
      )}

      {/* Main content area -- two-column on desktop */}
      <div className="flex gap-4">
        {/* Left: Book list sidebar (200px fixed, visible on desktop) */}
        <div className="w-[200px] flex-shrink-0 hidden md:block">
          <BookList
            books={books}
            selectedBookId={selectedBook?.id || null}
            onSelectBook={handleSelectBook}
            isLoading={isLoadingBooks}
          />
        </div>

        {/* Right: Main content area (flex-grow) */}
        <div className="flex-1 min-w-0">
          {/* Navigation state machine */}
          {!selectedBook && !isLoadingBooks && (
            <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4">
              <h2 className="text-xl font-semibold text-gray-100 mb-2">
                Select a book to begin
              </h2>
              <p className="text-sm text-gray-300">
                Choose a book from the list, or type a reference above to jump directly to a passage.
              </p>
            </div>
          )}

          {isLoadingBooks && (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent mr-2" />
              <span className="text-sm text-gray-400">Loading...</span>
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
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent mr-2" />
              <span className="text-sm text-gray-400">Loading...</span>
            </div>
          )}

          {selectedChapter && (
            <VerseDisplay
              reference={chapterContent?.reference || selectedChapter.reference}
              content={chapterContent?.content || ''}
              translationAbbreviation={currentTranslation?.abbreviation || ''}
              isLoading={isLoadingContent}
              error={error}
              onRetry={handleRetry}
            />
          )}

          {/* Error display when no chapter selected */}
          {error && !selectedChapter && (
            <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-4 mt-4">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: show BookList as full-width when no book selected */}
      {!selectedBook && (
        <div className="md:hidden">
          <BookList
            books={books}
            selectedBookId={null}
            onSelectBook={handleSelectBook}
            isLoading={isLoadingBooks}
          />
        </div>
      )}
    </div>
  );
}
