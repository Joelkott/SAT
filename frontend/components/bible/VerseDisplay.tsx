'use client';

interface VerseDisplayProps {
  reference: string;
  content: string;
  translationAbbreviation: string;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
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
}: VerseDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4 flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent mr-2" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-4">
        <p className="text-red-300 text-sm">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-red-400 hover:text-red-300 underline text-sm mt-2"
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
    <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4">
      <h3 className="text-base font-semibold text-gray-100 mb-3">
        {reference} ({translationAbbreviation})
      </h3>
      <div className="text-base leading-relaxed text-gray-100">
        {paragraphs.map((paragraph) => (
          <p key={paragraph.key} className="mb-4">
            {paragraph.parts.map((part, i) =>
              part.type === 'verse-number' ? (
                <sup
                  key={i}
                  className="text-xs font-semibold text-blue-400 mr-1"
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
