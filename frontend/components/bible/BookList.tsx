'use client';

import { BibleBook } from '@/lib/api';

interface BookListProps {
  books: BibleBook[];
  selectedBookId: string | null;
  onSelectBook: (book: BibleBook) => void;
  isLoading: boolean;
}

export default function BookList({
  books,
  selectedBookId,
  onSelectBook,
  isLoading,
}: BookListProps) {
  if (isLoading) {
    return (
      <div className="bg-[#1a1b1f] border border-[#2a2c31] rounded-xl p-4 flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent mr-2" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  // Split into Old Testament (first 39) and New Testament (remaining)
  const oldTestament = books.slice(0, 39);
  const newTestament = books.slice(39);

  return (
    <div className="bg-[#1a1b1f] border border-[#2a2c31] rounded-xl overflow-y-auto max-h-[calc(100vh-240px)]">
      {oldTestament.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2">
            Old Testament
          </div>
          {oldTestament.map((book) => (
            <button
              key={book.id}
              onClick={() => onSelectBook(book)}
              className={`w-full text-left px-4 py-2 min-h-[36px] cursor-pointer text-sm transition-colors ${
                selectedBookId === book.id
                  ? 'bg-[#2c2d32] text-gray-100 border-l-2 border-blue-600'
                  : 'text-gray-300 hover:bg-[#22232a]'
              }`}
            >
              {book.name}
            </button>
          ))}
        </>
      )}
      {newTestament.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 mt-2">
            New Testament
          </div>
          {newTestament.map((book) => (
            <button
              key={book.id}
              onClick={() => onSelectBook(book)}
              className={`w-full text-left px-4 py-2 min-h-[36px] cursor-pointer text-sm transition-colors ${
                selectedBookId === book.id
                  ? 'bg-[#2c2d32] text-gray-100 border-l-2 border-blue-600'
                  : 'text-gray-300 hover:bg-[#22232a]'
              }`}
            >
              {book.name}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
