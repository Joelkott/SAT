'use client';

import type { VerseDetectStatus } from '@/lib/api';

interface VerseDetectToggleProps {
  status: VerseDetectStatus | null;
  onToggle: (on: boolean) => void;
}

interface ToggleView {
  dot: string;
  label: string;
  title: string;
  disabled: boolean;
  active: boolean;
}

// First match wins: unknown -> not configured -> off -> stream down ->
// caption service not running -> listening.
function viewFor(status: VerseDetectStatus | null): ToggleView {
  if (!status) {
    return { dot: 'bg-edge-strong', label: 'Detect…', title: 'Checking verse detection…', disabled: true, active: false };
  }
  if (!status.configured) {
    return {
      dot: 'bg-edge-strong',
      label: 'Detect: n/a',
      title: 'Verse detection is not configured on the server',
      disabled: true,
      active: false,
    };
  }
  if (!status.enabled) {
    return {
      dot: 'bg-edge-strong',
      label: 'Detect: off',
      title: 'Click to listen to the sermon captions and suggest verses',
      disabled: false,
      active: false,
    };
  }
  if (status.stream !== 'connected') {
    return {
      dot: 'bg-warn',
      label: 'Stream offline',
      title: 'Caption stream unreachable — retrying. Click to turn detection off.',
      disabled: false,
      active: false,
    };
  }
  if (!['', 'ready', 'live'].includes(status.service_status)) {
    return {
      dot: 'bg-warn',
      label: 'Detect: waiting',
      title: `Caption service is ${status.service_status}. Click to turn detection off.`,
      disabled: false,
      active: false,
    };
  }
  return {
    dot: 'bg-ok animate-pulse',
    label: 'Listening',
    title: `Listening to sermon captions for verse references (${status.jev ? 'Jev on' : 'local only'}). Click to turn off.`,
    disabled: false,
    active: true,
  };
}

export default function VerseDetectToggle({ status, onToggle }: VerseDetectToggleProps) {
  const view = viewFor(status);
  return (
    <button
      onClick={() => {
        if (!view.disabled && status) onToggle(!status.enabled);
      }}
      role="switch"
      aria-checked={!!status?.enabled}
      disabled={view.disabled}
      title={view.title}
      className={`h-9 px-3 flex items-center gap-2 rounded-lg border text-sm font-medium transition-colors duration-150 ${
        view.disabled ? 'cursor-default opacity-70' : 'cursor-pointer'
      } ${
        view.active
          ? 'bg-ok/10 border-ok/40 text-ok'
          : 'bg-surface-input border-edge text-ink-dim hover:text-ink hover:border-edge-strong'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${view.dot}`} />
      {view.label}
    </button>
  );
}
