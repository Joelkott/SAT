'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { BookOpenIcon, EyeIcon, EyeOffIcon } from '@/components/icons';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      localStorage.setItem('sat-token', res.data.token);
      localStorage.setItem('sat-role', res.data.role);
      window.location.href = '/';
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Login failed — check the connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-ink flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-surface-raised border border-edge rounded-2xl p-8 space-y-5 fade-swap">
        <div className="flex flex-col items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <BookOpenIcon className="w-6 h-6 text-accent-hover" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold">SAT Worship Display</h1>
            <p className="text-xs text-ink-mute mt-0.5">Sign in with your team account</p>
          </div>
        </div>
        <div>
          <label htmlFor="u" className="block text-sm font-medium text-ink-dim mb-1.5">Team</label>
          <input
            id="u"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="media, worship or admin"
            className="w-full px-4 py-2.5 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute"
          />
        </div>
        <div>
          <label htmlFor="p" className="block text-sm font-medium text-ink-dim mb-1.5">Password</label>
          <div className="relative">
            <input
              id="p"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full pl-4 pr-11 py-2.5 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-ink-mute hover:text-ink cursor-pointer"
            >
              {showPw ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full h-11 rounded-lg bg-accent-deep hover:bg-accent text-on-accent font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
