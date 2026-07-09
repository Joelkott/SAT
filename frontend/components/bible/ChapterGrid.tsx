'use client';

import { BibleChapter } from '@/lib/api';

interface ChapterGridProps {
  chapters: BibleChapter[];
  selectedChapterId: string | null;
  onSelectChapter: (chapter: BibleChapter) => void;
  bookName: string;
  isLoading: boolean;
}

export default function ChapterGrid({
  chapters,
  selectedChapterId,
  onSelectChapter,
  bookName,
  isLoading,
}: ChapterGridProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
        <span className="text-sm text-ink-mute">Loading...</span>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised border border-edge rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">
          {bookName}
          <span className="text-ink-mute font-normal ml-2">select a chapter</span>
        </h3>
        <span className="text-xs text-ink-mute tabular-nums">{chapters.length} chapters</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
        {chapters.map((chapter) => (
          <button
            key={chapter.id}
            onClick={() => onSelectChapter(chapter)}
            className={`h-10 rounded-lg text-sm tabular-nums cursor-pointer transition-colors duration-150 ${
              selectedChapterId === chapter.id
                ? 'bg-accent-deep text-on-accent font-medium'
                : 'bg-surface-input border border-edge text-ink-dim hover:border-accent/60 hover:text-ink'
            }`}
          >
            {chapter.number}
          </button>
        ))}
      </div>
    </div>
  );
}
