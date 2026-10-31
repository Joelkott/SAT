'use client';

import { useEffect, useRef, useState } from 'react';
import { XIcon } from '@/components/icons';
import type { ActiveDetection } from '@/components/bible/useVerseDetect';

interface VerseDetectBannerProps {
  detection: ActiveDetection;
  // Must go through BiblePanel's pending-send-safe path (lookupAndSend), never a direct wall send.
  onSend: (passage: string) => Promise<{ ok: boolean; message?: string }>;
  onDismiss: () => void;
}

const ERROR_MS = 4000;

// Media-only banner for a verse detected in the live sermon captions.
// No Enter shortcut: Enter already sends the selection / accepts mirror banners.
export default function VerseDetectBanner({ detection, onSend, onDismiss }: VerseDetectBannerProps) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const showError = (message: string) => {
    setError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setError('');
    }, ERROR_MS);
  };

  const handleSend = async () => {
    if (isSending) return;
    setIsSending(true);
    setError('');
    try {
      const outcome = await onSend(detection.passage);
      if (!mountedRef.current) return;
      if (outcome.ok) {
        onDismiss();
        return;
      }
      showError(outcome.message || 'Could not send to the wall');
    } catch (err) {
      console.error('Error sending detected verse:', err);
      if (mountedRef.current) showError('Could not send to the wall');
    } finally {
      if (mountedRef.current) setIsSending(false);
    }
  };

  return (
    <div
      role="status"
      className="fade-swap flex items-center gap-3 bg-accent/10 border border-accent/40 rounded-lg px-4 py-2.5"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink">
          Detected: <span className="font-semibold text-accent-hover">{detection.reference}</span>
          {' · '}
          {Math.round(detection.confidence * 100)}%
        </p>
        {detection.snippet && (
          <p className="text-xs text-ink-mute truncate" title={detection.snippet}>
            &ldquo;{detection.snippet}&rdquo;
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <button
        onClick={handleSend}
        disabled={isSending}
        title="Navigate to this verse and send it to the wall"
        className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-60 disabled:cursor-default shrink-0"
      >
        {isSending ? 'Sending…' : 'Send to Wall'}
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss detection"
        className="p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150 shrink-0"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
