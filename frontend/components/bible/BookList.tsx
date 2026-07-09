'use client';

import { BibleBook } from '@/lib/api';

interface BookListProps {
  books: BibleBook[];
  selectedBookId: string | null;
  onSelectBook: (book: BibleBook) => void;
  isLoading: boolean;
}

function Section({
  title,
  books,
  selectedBookId,
  onSelectBook,
}: {
  title: string;
  books: BibleBook[];
  selectedBookId: string | null;
  onSelectBook: (book: BibleBook) => void;
}) {
  if (books.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm text-[10px] font-semibold text-ink-mute uppercase tracking-widest px-4 pt-3 pb-1.5 border-b border-edge/50">
        {title}
      </div>
      <div className="px-2 py-1.5 space-y-px">
        {books.map((book) => {
          const selected = selectedBookId === book.id;
          return (
            <button
              key={book.id}
              onClick={() => onSelectBook(book)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-[13px] cursor-pointer transition-colors duration-150 ${
                selected
                  ? 'bg-accent/15 text-accent-hover font-medium'
                  : 'text-ink-dim hover:bg-surface-hover hover:text-ink'
              }`}
            >
              {book.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BookList({
  books,
  selectedBookId,
  onSelectBook,
  isLoading,
}: BookListProps) {
  if (isLoading) {
    return (
      <div className="bg-surface-raised border border-edge rounded-xl p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
        <span className="text-sm text-ink-mute">Loading...</span>
      </div>
    );
  }

  // Protestant canon: first 39 books are Old Testament.
  const oldTestament = books.slice(0, 39);
  const newTestament = books.slice(39);

  return (
    <div className="bg-surface-raised border border-edge rounded-xl overflow-y-auto max-h-[calc(100vh-200px)]">
      <Section
        title="Old Testament"
        books={oldTestament}
        selectedBookId={selectedBookId}
        onSelectBook={onSelectBook}
      />
      <Section
        title="New Testament"
        books={newTestament}
        selectedBookId={selectedBookId}
        onSelectBook={onSelectBook}
      />
    </div>
  );
}
