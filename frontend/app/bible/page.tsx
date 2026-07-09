'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { bibleApiClient, BibleTranslation, BibleBook, BibleChapter } from '@/lib/bibleApi';
import SettingsDialog from '@/components/SettingsDialog';

export default function BibleControl() {
  const router = useRouter();
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [selectedTranslation, setSelectedTranslation] = useState<string>('');
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [selectedVerse, setSelectedVerse] = useState<number>(1);
  const [showVerseRange, setShowVerseRange] = useState(false);
  const [selectedVerseEnd, setSelectedVerseEnd] = useState<number | null>(null);
  const [chapterData, setChapterData] = useState<BibleChapter | null>(null);
  const [additionalTranslations, setAdditionalTranslations] = useState<string[]>([]);
  const [additionalChapterData, setAdditionalChapterData] = useState<Map<string, BibleChapter>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translationsLoading, setTranslationsLoading] = useState(true);

  // Display settings
  const [showSettings, setShowSettings] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');

  // Bible verse notification from live captions
  const [bibleNotification, setBibleNotification] = useState<{
    book: string;
    bookId: string;
    chapter: number;
    verse: number;
    endVerse?: number;
  } | null>(null);

  // Load available translations on mount
  useEffect(() => {
    loadTranslations();
  }, []);

  // Load books when translation changes
  useEffect(() => {
    if (selectedTranslation) {
      loadBooks(selectedTranslation);
    }
  }, [selectedTranslation]);

  // Load chapter when book or chapter changes
  useEffect(() => {
    if (selectedTranslation && selectedBook && selectedChapter) {
      loadChapter(selectedTranslation, selectedBook, selectedChapter);
    }
  }, [selectedTranslation, selectedBook, selectedChapter]);

  // Define sendVerseToDisplay with useCallback so it can be used in SSE useEffect
  const sendVerseToDisplay = useCallback((verse: number, endVerse?: number | null) => {
    if (!chapterData || !chapterData.verses) return;

    // Get filtered verses based on the provided verse and endVerse
    let filteredVerses;
    if (showVerseRange && endVerse) {
      filteredVerses = chapterData.verses.filter(
        v => v.verse >= verse && v.verse <= endVerse
      );
    } else {
      filteredVerses = chapterData.verses.filter(v => v.verse === verse);
    }

    // Format text
    let formattedText = '';

    if (additionalTranslations.length > 0) {
      // Multi-version display
      const allVersions = [
        { id: selectedTranslation, data: chapterData },
        ...additionalTranslations.map(id => ({ id, data: additionalChapterData.get(id) }))
      ].filter(v => v.data);

      formattedText = filteredVerses.map((v) => {
        const versionTexts = allVersions.map(ver => {
          const verseData = ver.data?.verses.find(vv => vv.verse === v.verse);
          return `[${ver.id}] ${verseData?.text || ''}`;
        }).join('\n\n');

        return versionTexts;
      }).join('\n\n---\n\n');
    } else {
      // Single version display
      formattedText = filteredVerses
        .map(v => v.text)
        .join('\n\n');
    }

    const verseRange = showVerseRange && endVerse && endVerse !== verse
      ? `${verse}-${endVerse}`
      : `${verse}`;

    const currentBook = books.find(b => b.id === selectedBook);
    const bookName = currentBook?.name || selectedBook;
    const reference = `${bookName} ${selectedChapter}:${verseRange}`;

    const displayPayload = {
      type: 'bible',
      bible: {
        id: `${selectedTranslation}-${selectedBook}-${selectedChapter}-${verseRange}`,
        title: reference,
        subtitle: selectedTranslation,
        content: formattedText,
        language: 'english',
        reference: reference,
      },
    };

    // Save to localStorage for display page
    localStorage.setItem('lyrics-display-current', JSON.stringify(displayPayload.bible));

    // Broadcast to display window
    const channel = new BroadcastChannel('lyrics-display');
    channel.postMessage(displayPayload);
    channel.close();
  }, [chapterData, showVerseRange, additionalTranslations, selectedTranslation, additionalChapterData, selectedBook, selectedChapter, books]);

  // Listen for Bible verse events from backend SSE
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const sseUrl = `${apiUrl}/api/bible/sse`;

    console.log('📡 Connecting to Bible SSE:', sseUrl);
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle connection confirmation
        if (data.type === 'connected') {
          console.log('✅ Connected to Bible SSE (client ID:', data.clientId, ')');
          return;
        }

        // Handle Bible verse events - show notification instead of auto-navigating
        if (data.type === 'bible_verse') {
          console.log('📖 Received Bible verse from backend:', data);

          // Find matching book in current books list
          const matchingBook = books.find(b =>
            b.name.toLowerCase() === data.book.toLowerCase() ||
            b.id.toLowerCase() === data.book.toLowerCase()
          );

          if (matchingBook) {
            // Show notification with verse details
            setBibleNotification({
              book: matchingBook.name,
              bookId: matchingBook.id,
              chapter: data.chapter,
              verse: data.verse,
              endVerse: data.endVerse,
            });
          } else {
            console.warn(`⚠️  Book "${data.book}" not found in current translation`);
          }
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    eventSource.onopen = () => {
      console.log('✅ SSE connection opened');
    };

    eventSource.onerror = (err) => {
      console.error('❌ SSE connection error:', err);
    };

    return () => {
      console.log('🔌 Disconnecting from Bible SSE');
      eventSource.close();
    };
  }, [books]); // Only depend on books, not sendVerseToDisplay

  const loadTranslations = async () => {
    try {
      setTranslationsLoading(true);
      setError(null);
      const data = await bibleApiClient.getTranslations();
      console.log('Translations loaded:', data);
      setTranslations(data);
      // Set default translation to first available
      if (data.length > 0) {
        setSelectedTranslation(data[0].id);
      }
    } catch (err: any) {
      console.error('Error loading translations:', err);
      setError('Failed to load Bible translations');
    } finally {
      setTranslationsLoading(false);
    }
  };

  const loadBooks = async (translation: string) => {
    try {
      setError(null);
      console.log('Loading books for translation:', translation);
      const data = await bibleApiClient.getBooks(translation);
      console.log('Books loaded:', data);
      setBooks(data);
      // Set default book to first available
      if (data.length > 0) {
        setSelectedBook(data[0].id);
        setSelectedChapter(1);
      }
    } catch (err: any) {
      console.error('Error loading books:', err);
      setError('Failed to load books');
    }
  };

  const loadChapter = async (translation: string, book: string, chapter: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await bibleApiClient.getChapter(translation, book, chapter);
      console.log('Chapter data loaded:', data);
      setChapterData(data);

      // Initialize verse selection when chapter loads
      if (data && data.verses && data.verses.length > 0) {
        setSelectedVerse(1);
        if (showVerseRange) {
          setSelectedVerseEnd(data.verses.length);
        }
      }

      // Reload additional translations
      additionalTranslations.forEach(trans => {
        loadAdditionalChapter(trans, book, chapter);
      });
    } catch (err: any) {
      console.error('Error loading chapter:', err);
      setError('Failed to load chapter');
      setChapterData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTranslationChange = (value: string) => {
    setSelectedTranslation(value);
    setSelectedBook('');
    setSelectedChapter(1);
    setChapterData(null);
  };

  const handleBookChange = (value: string) => {
    setSelectedBook(value);
    setSelectedChapter(1);
    setSelectedVerse(1);
    setSelectedVerseEnd(null);
  };

  const handleChapterChange = (value: number) => {
    setSelectedChapter(value);
    setSelectedVerse(1);
    setSelectedVerseEnd(null);
  };

  const handleVerseChange = (value: number) => {
    setSelectedVerse(value);
    if (selectedVerseEnd && value > selectedVerseEnd) {
      setSelectedVerseEnd(value);
    }
  };

  const handleVerseEndChange = (value: number) => {
    setSelectedVerseEnd(value);
  };

  const handleAddTranslation = (translationId: string) => {
    if (!additionalTranslations.includes(translationId) && translationId !== selectedTranslation) {
      setAdditionalTranslations([...additionalTranslations, translationId]);
      loadAdditionalChapter(translationId, selectedBook, selectedChapter);
    }
  };

  const handleRemoveTranslation = (translationId: string) => {
    setAdditionalTranslations(additionalTranslations.filter(t => t !== translationId));
    const newMap = new Map(additionalChapterData);
    newMap.delete(translationId);
    setAdditionalChapterData(newMap);
  };

  const loadAdditionalChapter = async (translation: string, book: string, chapter: number) => {
    try {
      const data = await bibleApiClient.getChapter(translation, book, chapter);
      const newMap = new Map(additionalChapterData);
      newMap.set(translation, data);
      setAdditionalChapterData(newMap);
    } catch (err: any) {
      console.error('Error loading additional chapter:', err);
    }
  };

  const getCurrentBook = () => {
    return books.find(b => b.id === selectedBook);
  };

  const getFilteredVerses = (data?: BibleChapter) => {
    const targetData = data || chapterData;
    if (!targetData || !targetData.verses) return [];

    if (showVerseRange && selectedVerseEnd) {
      return targetData.verses.filter(
        v => v.verse >= selectedVerse && v.verse <= selectedVerseEnd
      );
    } else {
      return targetData.verses.filter(v => v.verse === selectedVerse);
    }
  };

  const handlePreviousVerse = () => {
    if (!chapterData || !chapterData.verses || selectedVerse <= 1) return;

    const newVerse = selectedVerse - 1;
    setSelectedVerse(newVerse);

    // If in range mode, adjust the end verse too
    let newEnd = selectedVerseEnd;
    if (showVerseRange && selectedVerseEnd) {
      const range = selectedVerseEnd - selectedVerse;
      newEnd = Math.min(newVerse + range, chapterData.verses.length);
      setSelectedVerseEnd(newEnd);
    }

    // Auto-send to display
    setTimeout(() => {
      sendVerseToDisplay(newVerse, newEnd);
    }, 50);
  };

  const handleNextVerse = () => {
    if (!chapterData || !chapterData.verses) return;

    const maxVerse = chapterData.verses.length;
    if (selectedVerse >= maxVerse) return;

    const newVerse = selectedVerse + 1;
    setSelectedVerse(newVerse);

    // If in range mode, adjust the end verse too
    let newEnd = selectedVerseEnd;
    if (showVerseRange && selectedVerseEnd) {
      const range = selectedVerseEnd - selectedVerse;
      newEnd = Math.min(newVerse + range, maxVerse);
      setSelectedVerseEnd(newEnd);
    }

    // Auto-send to display
    setTimeout(() => {
      sendVerseToDisplay(newVerse, newEnd);
    }, 50);
  };

  const handleSendToDisplay = () => {
    sendVerseToDisplay(selectedVerse, selectedVerseEnd);
  };

  const handleClearDisplay = () => {
    // Clear localStorage
    localStorage.removeItem('lyrics-display-current');

    // Broadcast clear message to display window
    const channel = new BroadcastChannel('lyrics-display');
    channel.postMessage({ type: 'clear' });
    channel.close();
  };

  const handleGoToNotifiedVerse = () => {
    if (!bibleNotification) return;

    // Navigate to the verse
    setSelectedBook(bibleNotification.bookId);
    setSelectedChapter(bibleNotification.chapter);
    setSelectedVerse(bibleNotification.verse);

    // Set end verse if provided
    if (bibleNotification.endVerse) {
      setShowVerseRange(true);
      setSelectedVerseEnd(bibleNotification.endVerse);
    } else {
      setShowVerseRange(false);
      setSelectedVerseEnd(null);
    }

    // Dismiss notification
    setBibleNotification(null);
  };

  const handleDismissNotification = () => {
    setBibleNotification(null);
  };

  return (
    <div className="min-h-screen bg-[#111214] text-gray-100">
      {/* Top Bar */}
      <div className="bg-[#1a1b1f] border-b border-[#2a2c31] px-6 py-3">
        <div className="max-w-full mx-auto flex items-center justify-between gap-4">
          {/* Left: Back Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#141518] border border-[#2a2c31] hover:border-[#3a3c42] transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Songs
            </button>
            <h1 className="text-xl font-bold">Bible Control</h1>
          </div>

          {/* Right: Display Button and Settings */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="h-9 w-9 flex items-center justify-center rounded-md bg-[#141518] border border-[#2a2c31] hover:border-[#3a3c42] transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={handleClearDisplay}
              className="px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              title="Clear Display"
            >
              Clear Display
            </button>
            <button
              onClick={() => window.open('/display', '_blank', 'noopener,noreferrer')}
              className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Launch Display
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* Bible Verse Notification */}
        {bibleNotification && (
          <div className="mb-4 bg-blue-900/20 border border-blue-500 rounded-lg p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <p className="text-blue-100 font-medium">
                  Bible Reference Detected from Live Captions
                </p>
                <p className="text-blue-300 text-sm mt-0.5">
                  {bibleNotification.book} {bibleNotification.chapter}:
                  {bibleNotification.endVerse
                    ? `${bibleNotification.verse}-${bibleNotification.endVerse}`
                    : bibleNotification.verse
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleGoToNotifiedVerse}
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                Go to Verse
              </button>
              <button
                onClick={handleDismissNotification}
                className="px-3 py-2 rounded-md bg-[#141518] border border-[#2a2c31] hover:border-[#3a3c42] text-gray-400 hover:text-white text-sm transition-colors"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Selection Controls */}
        <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-6 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Translation Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Bible Version
              </label>
              <select
                value={selectedTranslation}
                onChange={(e) => handleTranslationChange(e.target.value)}
                disabled={translationsLoading}
                className="w-full bg-[#141518] border border-[#2a2c31] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {translationsLoading ? (
                  <option>Loading...</option>
                ) : (
                  (translations || []).map((trans) => (
                    <option key={trans.id} value={trans.id}>
                      {trans.id} - {trans.englishName}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Book Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Book
              </label>
              <select
                value={selectedBook}
                onChange={(e) => handleBookChange(e.target.value)}
                disabled={!selectedTranslation || books.length === 0}
                className="w-full bg-[#141518] border border-[#2a2c31] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {(books || []).map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Chapter Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Chapter
              </label>
              <select
                value={selectedChapter}
                onChange={(e) => handleChapterChange(Number(e.target.value))}
                disabled={!selectedBook}
                className="w-full bg-[#141518] border border-[#2a2c31] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {getCurrentBook() &&
                  Array.from({ length: getCurrentBook()!.numberOfChapters }, (_, i) => i + 1).map((num) => (
                    <option key={num} value={num}>
                      Chapter {num}
                    </option>
                  ))}
              </select>
            </div>

            {/* Verse Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Verse
              </label>
              <select
                value={selectedVerse}
                onChange={(e) => handleVerseChange(Number(e.target.value))}
                disabled={!chapterData || !chapterData.verses || chapterData.verses.length === 0}
                className="w-full bg-[#141518] border border-[#2a2c31] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {!chapterData?.verses || chapterData.verses.length === 0 ? (
                  <option>No verses</option>
                ) : (
                  chapterData.verses.map((verse) => (
                    <option key={verse.verse} value={verse.verse}>
                      {verse.verse}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Additional Translations */}
          <div className="mt-3 pt-3 border-t border-[#2a2c31]">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-400 whitespace-nowrap">
                Compare Versions:
              </label>
              <div className="flex flex-wrap gap-1.5 flex-1">
                {additionalTranslations.map((transId) => (
                  <div key={transId} className="flex items-center gap-1 bg-[#141518] border border-[#2a2c31] rounded px-1.5 py-0.5">
                    <span className="text-xs text-white">{transId}</span>
                    <button
                      onClick={() => handleRemoveTranslation(transId)}
                      className="text-gray-400 hover:text-white text-sm leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddTranslation(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="text-xs bg-[#141518] border border-[#2a2c31] rounded px-2 py-0.5 text-gray-400 focus:outline-none focus:border-blue-500 hover:border-[#3a3c42] cursor-pointer h-6"
                >
                  <option value="">+ Add</option>
                  {translations
                    .filter(t => t.id !== selectedTranslation && !additionalTranslations.includes(t.id))
                    .map((trans) => (
                      <option key={trans.id} value={trans.id}>
                        {trans.id} - {trans.englishName}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="mt-4 pt-4 border-t border-[#2a2c31]">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handlePreviousVerse}
                disabled={!chapterData || selectedVerse <= 1}
                className="flex items-center gap-2 px-6 py-2 rounded-md bg-[#141518] border border-[#2a2c31] hover:border-blue-500 hover:bg-[#1f2023] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>

              <button
                onClick={() => {
                  handleSendToDisplay();
                }}
                disabled={!chapterData || loading}
                className="px-8 py-2 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Send to Display
              </button>

              <button
                onClick={handleNextVerse}
                disabled={!chapterData || !chapterData.verses || selectedVerse >= (chapterData.verses.length)}
                className="flex items-center gap-2 px-6 py-2 rounded-md bg-[#141518] border border-[#2a2c31] hover:border-blue-500 hover:bg-[#1f2023] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Next
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Chapter Display */}
        <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-400">Loading chapter...</div>
            </div>
          ) : chapterData ? (
            <>
              <div className="mb-4 pb-4 border-b border-[#2a2c31]">
                <h2 className="text-2xl font-bold text-white">
                  {getCurrentBook()?.name || selectedBook} {selectedChapter}
                </h2>
                <p className="text-gray-400 text-sm mt-1">{selectedTranslation}</p>
              </div>
              <div className="space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
                {additionalTranslations.length > 0 ? (
                  // Multi-version display
                  getFilteredVerses().map((verse) => (
                    <div key={verse.verse} className="border-b border-[#2a2c31] pb-4 mb-4 last:border-0">
                      <div className="text-blue-400 font-semibold text-sm mb-2">Verse {verse.verse}</div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">[{selectedTranslation}]</div>
                          <p className="text-gray-200 leading-relaxed">{verse.text}</p>
                        </div>
                        {additionalTranslations.map((transId) => {
                          const transData = additionalChapterData.get(transId);
                          const transVerse = transData?.verses.find(v => v.verse === verse.verse);
                          return transVerse ? (
                            <div key={transId}>
                              <div className="text-xs text-gray-500 mb-1">[{transId}]</div>
                              <p className="text-gray-200 leading-relaxed">{transVerse.text}</p>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  // Single version display
                  getFilteredVerses().map((verse) => (
                    <div key={verse.verse} className="flex gap-3">
                      <span className="text-blue-400 font-semibold text-sm flex-shrink-0 w-8">
                        {verse.verse}
                      </span>
                      <p className="text-gray-200 leading-relaxed">{verse.text}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#141518] flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p className="text-gray-500 text-base">Select a Bible version, book, and chapter</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
