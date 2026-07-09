'use client';

interface VerseGridProps {
  verseNumbers: string[];
  selectedVerse: string | null;
  onSelectVerse: (verseNumber: string) => void;
  onShowFullChapter: () => void;
}

// Compact verse strip: small wrapping chips so the scripture itself stays
// above the fold even for long chapters.
export default function VerseGrid({
  verseNumbers,
  selectedVerse,
  onSelectVerse,
  onShowFullChapter,
}: VerseGridProps) {
  if (verseNumbers.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-raised border border-edge rounded-xl px-3 py-2.5 mb-4">
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={onShowFullChapter}
          className={`h-8 px-3 rounded-md text-xs font-medium cursor-pointer transition-colors duration-150 mr-1 ${
            selectedVerse === null
              ? 'bg-accent-deep text-on-accent'
              : 'bg-surface-input border border-edge text-ink-dim hover:border-accent/60 hover:text-ink'
          }`}
        >
          Full chapter
        </button>
        <span className="w-px h-5 bg-edge mx-1" aria-hidden />
        {verseNumbers.map((num) => (
          <button
            key={num}
            onClick={() => onSelectVerse(num)}
            aria-label={`Verse ${num}`}
            className={`h-8 min-w-[32px] px-1.5 rounded-md text-[13px] tabular-nums cursor-pointer transition-colors duration-150 ${
              selectedVerse === num
                ? 'bg-accent-deep text-on-accent font-semibold'
                : 'text-ink-dim hover:bg-surface-hover hover:text-ink'
            }`}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );
}
