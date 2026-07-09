'use client';

interface VerseDisplayProps {
  reference: string;
  content: string;
  translationAbbreviation: string;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  onVerseClick?: (verseNumber: string) => void;
  // Indic scripts (Malayalam, Hindi, ...) need taller line boxes.
  indic?: boolean;
}

function parseVerseContent(content: string) {
  // Split content by double newlines into paragraphs
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());

  return paragraphs.map((paragraph, pIdx) => {
    // Parse verse numbers like [1], [2], etc.
    const parts: { type: 'verse-number' | 'text'; value: string }[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(paragraph)) !== null) {
      // Add text before verse number
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: paragraph.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'verse-number', value: match[1] });
      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < paragraph.length) {
      parts.push({ type: 'text', value: paragraph.slice(lastIndex) });
    }

    return { key: pIdx, parts };
  });
}

export default function VerseDisplay({
  reference,
  content,
  translationAbbreviation,
  isLoading,
  error,
  onRetry,
  onVerseClick,
  indic,
}: VerseDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-surface-raised rounded-xl border border-edge p-4 flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-ink-mute border-t-transparent mr-2" />
        <span className="text-sm text-ink-mute">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
        <p className="text-danger text-sm">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-danger hover:text-danger underline text-sm mt-2"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const paragraphs = parseVerseContent(content);

  return (
    <div className="bg-surface-raised rounded-xl border border-edge overflow-hidden flex flex-col">
      {/* Column header: translation badge + localized reference */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-edge bg-surface-sunken/50 shrink-0">
        <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent-hover text-[11px] font-bold tracking-wide uppercase shrink-0">
          {translationAbbreviation}
        </span>
        <h3 className="text-sm font-semibold text-ink truncate">{reference}</h3>
      </div>
      {/* Scripture body: scrolls within the card so side-by-side columns stay aligned */}
      <div className={`px-4 py-4 overflow-y-auto max-h-[58vh] text-ink ${indic ? 'script-indic text-[17px]' : 'text-base leading-relaxed'}`}>
        {paragraphs.map((paragraph) => (
          <p key={paragraph.key} className="mb-4 last:mb-0">
            {paragraph.parts.map((part, i) =>
              part.type === 'verse-number' ? (
                <sup
                  key={i}
                  className={`text-[11px] font-bold text-accent-hover mr-1${onVerseClick ? ' cursor-pointer hover:text-accent' : ''}`}
                  onClick={onVerseClick ? () => onVerseClick(part.value) : undefined}
                  title={onVerseClick ? `View verse ${part.value}` : undefined}
                >
                  {part.value}
                </sup>
              ) : (
                <span key={i}>{part.value}</span>
              )
            )}
          </p>
        ))}
      </div>
    </div>
  );
}
