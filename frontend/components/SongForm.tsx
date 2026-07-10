'use client';

import { useState, useEffect } from 'react';
import { Song, songsApi, CreateSongRequest, UpdateSongRequest } from '@/lib/api';

interface SongFormProps {
  song?: Song | null;
  onSubmit: () => void;
  onCancel: () => void;
}

const LANGUAGES = ['english', 'malayalam', 'hindi', 'tamil', 'telugu', 'kannada'];

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
      setError('Title, lyrics, and language are required');
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
      setError(err.response?.data?.error || 'Failed to save song');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-ink-dim mb-2">
            Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150"
            placeholder="Enter song title"
            required
          />
        </div>

        {/* Artist */}
        <div>
          <label htmlFor="artist" className="block text-sm font-medium text-ink-dim mb-2">
            Artist (Optional)
          </label>
          <input
            id="artist"
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150"
            placeholder="Enter artist name"
          />
        </div>

        {/* Language */}
        <div>
          <label htmlFor="language" className="block text-sm font-medium text-ink-dim mb-2">
            Language *
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150"
            required
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang.charAt(0).toUpperCase() + lang.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Lyrics */}
        <div>
          <label htmlFor="lyrics" className="block text-sm font-medium text-ink-dim mb-2">
            Lyrics *
          </label>
          <textarea
            id="lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={14}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150 font-mono text-sm"
            placeholder={"[Verse 1]\nEnter song lyrics..."}
            required
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-4" role="alert">
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-accent-deep hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-on-accent font-semibold py-3 px-4 rounded-lg cursor-pointer transition-colors duration-150"
          >
            {loading ? 'Saving...' : song ? 'Update Song' : 'Create Song'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-surface-hover hover:bg-edge text-ink-dim hover:text-ink font-semibold py-3 px-4 rounded-lg cursor-pointer transition-colors duration-150 border border-edge-strong"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
