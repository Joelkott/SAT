'use client';

import { useRef, useState } from 'react';
import { remoteApi, setPairToken, errorCode, httpStatus, ClaimResponse } from '@/lib/remote';
import { getRole } from '@/lib/role';

interface PairFormProps {
  onPaired: (r: ClaimResponse) => void;
}

const CODE_LENGTH = 6;

function claimErrorMessage(err: any): string {
  const status = httpStatus(err);
  const code = errorCode(err);
  if (status === 429) {
    const secs = Number(err?.response?.data?.retry_after ?? 300);
    return `Too many attempts — try again in ${Math.max(1, Math.ceil(secs / 60))} min`;
  }
  if (code === 'code_invalid') return "That code didn't work. Check the control window and try again.";
  if (code === 'too_many_pairs') return 'Too many phones are paired with that window.';
  if (status === 403) return 'Controller needs a media, worship or admin account.';
  if (status === 404) return "Remote control isn't available on this server yet.";
  return "Couldn't reach the server.";
}

// 6-digit pair code entry (numeric keypad, auto-submits on the 6th digit).
export default function PairForm({ onPaired }: PairFormProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (value: string) => {
    if (busyRef.current || value.length !== CODE_LENGTH) return;
    busyRef.current = true;
    setIsPairing(true);
    setError('');
    try {
      const role = getRole();
      const r = await remoteApi.claim(value, `${role || 'team'} phone`);
      setPairToken(r.pair_token);
      onPaired(r);
    } catch (err: any) {
      console.error('Error pairing phone:', { status: httpStatus(err), code: errorCode(err) });
      setError(claimErrorMessage(err));
      setCode('');
      inputRef.current?.focus();
    } finally {
      busyRef.current = false;
      setIsPairing(false);
    }
  };

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) submit(digits);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(code);
  };

  return (
    <div className="p-4 max-w-md mx-auto">
      <form onSubmit={handleSubmit} className="bg-surface-raised border border-edge rounded-xl p-4 space-y-4">
        <h2 className="text-lg font-semibold">Pair with a control window</h2>
        <p className="text-sm text-ink-dim">
          On the control window click <strong className="text-ink">Pair phone</strong>, then enter the 6-digit code.
        </p>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          value={code}
          disabled={isPairing}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="000000"
          aria-label="Pair code"
          className="w-full h-16 px-3 text-3xl tracking-[0.4em] text-center tabular-nums bg-surface-input text-ink border border-edge rounded-lg focus:border-accent focus:outline-none placeholder:text-ink-mute/40 disabled:opacity-60"
        />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={isPairing || code.length !== CODE_LENGTH}
          className="w-full h-12 rounded-lg bg-accent-deep text-on-accent font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          {isPairing ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </div>
  );
}
