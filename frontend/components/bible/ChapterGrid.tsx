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
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent mr-2" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-100 mb-3">
        Select a Chapter
      </h3>
      <p className="text-sm text-gray-400 mb-3">
        {chapters.length} chapters
      </p>
      <div className="grid grid-cols-6 gap-2">
        {chapters.map((chapter) => (
          <button
            key={chapter.id}
            onClick={() => onSelectChapter(chapter)}
            className={`rounded-md h-10 w-full text-sm transition-colors ${
              selectedChapterId === chapter.id
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-[#16171b] border border-[#2a2c31] text-gray-300 hover:border-[#3a3c42] hover:text-gray-100'
            }`}
          >
            {chapter.number}
          </button>
        ))}
      </div>
    </div>
  );
}
