'use client';

import { useState, useEffect } from 'react';
import { Song, songsApi, CreateSongRequest, UpdateSongRequest } from '@/lib/api';

interface SongFormProps {
  song?: Song | null;
  onSubmit: () => void;
  onCancel: () => void;
}

const LANGUAGES = ['english', 'malayalam', 'hindi', 'tamil', 'telugu', 'kannada'];

const inputClass =
  'w-full px-3.5 py-2.5 bg-surface-input text-ink text-sm border border-edge rounded-lg ' +
  'hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute ' +
  'transition-colors duration-150';

export default function SongForm({ song, onSubmit, onCancel }: SongFormProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [language, setLanguage] = useState('english');
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (song) {
      setTitle(song.title);
      setArtist(song.artist || '');
      setLanguage(song.language);
      setLyrics(song.music_ministry_lyrics || song.display_lyrics);
    }
  }, [song]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || !lyrics.trim() || !language) {
      setError('Title and lyrics are required.');
      return;
    }

    try {
      setLoading(true);

      if (song) {
        // Update existing song. display_lyrics is a ProPresenter-only field —
        // never overwritten from the UI.
        const updates: UpdateSongRequest = {
          title: title.trim(),
          artist: artist.trim() || undefined,
          language: language,
          music_ministry_lyrics: lyrics.trim(),
        };
        await songsApi.update(song.id, updates);
      } else {
        // Create new song. Backend requires display_lyrics; seed it with the
        // same text (it is not shown anywhere in the app).
        const newSong: CreateSongRequest = {
          title: title.trim(),
          artist: artist.trim() || undefined,
          library: language,
          display_lyrics: lyrics.trim(),
          language: language,
          music_ministry_lyrics: lyrics.trim(),
        };
        await songsApi.create(newSong);
      }

      onSubmit();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save song. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const indic = ['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'].includes(language);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Song details */}
      <div className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-ink-dim mb-1.5">
            Title <span className="text-danger" aria-hidden>*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="Song title"
            autoComplete="off"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="artist" className="block text-sm font-medium text-ink-dim mb-1.5">
              Artist <span className="text-ink-mute font-normal">(optional)</span>
            </label>
            <input
              id="artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className={inputClass}
              placeholder="Artist or band"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="language" className="block text-sm font-medium text-ink-dim mb-1.5">
              Language <span className="text-danger" aria-hidden>*</span>
            </label>
            <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} className={`${inputClass} capitalize`} required>
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang} className="capitalize">
                  {lang.charAt(0).toUpperCase() + lang.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Lyrics — the main event */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="lyrics" className="text-sm font-medium text-ink-dim">
            Lyrics <span className="text-danger" aria-hidden>*</span>
          </label>
          <span className="text-xs text-ink-mute">
            Label sections like <code className="text-ink-dim bg-surface-sunken border border-edge rounded px-1 py-px">[Verse 1]</code>{' '}
            <code className="text-ink-dim bg-surface-sunken border border-edge rounded px-1 py-px">[Chorus]</code>
          </span>
        </div>
        <textarea
          id="lyrics"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={16}
          className={`${inputClass} resize-y min-h-[16rem] leading-relaxed ${indic ? 'script-indic text-base' : ''}`}
          placeholder={'[Verse 1]\nEnter the lyrics…\n\n[Chorus]\n…'}
          required
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3.5 py-2.5" role="alert">
          <span className="text-danger text-sm">{error}</span>
        </div>
      )}

      {/* Actions — one primary, one quiet */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-ink-dim hover:text-ink hover:bg-surface-hover border border-transparent hover:border-edge cursor-pointer transition-colors duration-150 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 rounded-lg bg-accent-deep hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-on-accent text-sm font-semibold cursor-pointer transition-colors duration-150"
        >
          {loading ? 'Saving…' : song ? 'Save changes' : 'Create song'}
        </button>
      </div>
    </form>
  );
}
