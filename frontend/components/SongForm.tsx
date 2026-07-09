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
  const [lyrics, setLyrics] = useState('');
  const [language, setLanguage] = useState('english');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (song) {
      setTitle(song.title);
      setArtist(song.artist || '');
      setLyrics(song.lyrics);
      setLanguage(song.language);
      setContent(song.content);
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
        // Update existing song
        const updates: UpdateSongRequest = {
          title: title.trim(),
          artist: artist.trim() || undefined,
          lyrics: lyrics.trim(),
          language: language,
          content: content.trim() || lyrics.trim(),
        };
        await songsApi.update(song.id, updates);
      } else {
        // Create new song
        const newSong: CreateSongRequest = {
          title: title.trim(),
          artist: artist.trim() || undefined,
          lyrics: lyrics.trim(),
          language: language,
          content: content.trim() || lyrics.trim(),
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
            rows={12}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150 font-mono text-sm"
            placeholder="Enter song lyrics..."
            required
          />
        </div>

        {/* Content (optional, defaults to lyrics) */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-ink-dim mb-2">
            Full Content (Optional, defaults to lyrics)
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full px-4 py-3 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute transition-colors duration-150 font-mono text-sm"
            placeholder="Enter full content (if different from lyrics)"
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
