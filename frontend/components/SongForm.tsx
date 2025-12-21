'use client';

import { useState, useEffect } from 'react';
import { Song, songsApi, CreateSongRequest, UpdateSongRequest } from '@/lib/api';

interface SongFormProps {
  song?: Song | null;
  onSubmit: (updatedSong?: Song) => void;
  onCancel: () => void;
}

const LANGUAGES = ['english', 'malayalam', 'hindi', 'tamil', 'telugu', 'kannada'];

export default function SongForm({ song, onSubmit, onCancel }: SongFormProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [library, setLibrary] = useState('Joshua English Slides');
  const [displayLyrics, setDisplayLyrics] = useState('');
  const [language, setLanguage] = useState('english');
  const [musicMinistryLyrics, setMusicMinistryLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (song) {
      setTitle(song.title);
      setArtist(song.artist || '');
      setLibrary(song.library);
      setDisplayLyrics(song.display_lyrics);
      setLanguage(song.language);
      setMusicMinistryLyrics(song.music_ministry_lyrics);
    }
  }, [song]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || !language || !library) {
      setError('Title, language, and library are required');
      return;
    }
    
    // At least one lyrics field must be provided
    if (!displayLyrics.trim() && !musicMinistryLyrics.trim()) {
      setError('At least one lyrics field (Display Lyrics or Music Ministry Lyrics) is required');
      return;
    }

    try {
      setLoading(true);

      if (song) {
        // Update existing song - send all fields that should be updated
        const updates: UpdateSongRequest = {
          title: title.trim(),
          library: library.trim(),
          language: language,
        };
        
        // Handle lyrics - use provided values or fallbacks
        if (displayLyrics.trim()) {
          updates.display_lyrics = displayLyrics.trim();
        }
        if (musicMinistryLyrics.trim()) {
          updates.music_ministry_lyrics = musicMinistryLyrics.trim();
        } else if (displayLyrics.trim()) {
          // Fallback to display lyrics if music ministry lyrics is empty
          updates.music_ministry_lyrics = displayLyrics.trim();
        }
        
        // Handle artist - can be empty string to clear it
        if (artist.trim()) {
          updates.artist = artist.trim();
        } else {
          updates.artist = '';
        }
        
        const updatedSong = await songsApi.update(song.id, updates);
        onSubmit(updatedSong);
      } else {
        // Create new song
        const newSong: CreateSongRequest = {
          title: title.trim(),
          artist: artist.trim() || undefined,
          library: library.trim(),
          display_lyrics: displayLyrics.trim(),
          language: language,
          music_ministry_lyrics: musicMinistryLyrics.trim() || displayLyrics.trim(),
        };
        const createdSong = await songsApi.create(newSong);
        onSubmit(createdSong);
      }
    } catch (err: any) {
      console.error('Error saving song:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Failed to save song';
      setError(errorMessage);
      // Don't close form on error so user can retry
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        {song ? 'Edit Song' : 'Create New Song'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white"
            placeholder="Enter song title"
            required
          />
        </div>

        {/* Artist */}
        <div>
          <label htmlFor="artist" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Artist (Optional)
          </label>
          <input
            id="artist"
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white"
            placeholder="Enter artist name"
          />
        </div>

        {/* Language */}
        <div>
          <label htmlFor="language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Language *
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white"
            required
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang.charAt(0).toUpperCase() + lang.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Library */}
        <div>
          <label htmlFor="library" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Library *
          </label>
          <input
            id="library"
            type="text"
            value={library}
            onChange={(e) => setLibrary(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white"
            placeholder="e.g., Joshua English Slides"
            required
          />
        </div>

        {/* Display Lyrics */}
        <div>
          <label htmlFor="displayLyrics" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Display Lyrics *
          </label>
          <textarea
            id="displayLyrics"
            value={displayLyrics}
            onChange={(e) => setDisplayLyrics(e.target.value)}
            rows={12}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white font-mono"
            placeholder="Enter display lyrics..."
            required
          />
        </div>

        {/* Music Ministry Lyrics (optional, defaults to display lyrics) */}
        <div>
          <label htmlFor="musicMinistryLyrics" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Music Ministry Version (Original)
          </label>
          <textarea
            id="musicMinistryLyrics"
            value={musicMinistryLyrics}
            onChange={(e) => setMusicMinistryLyrics(e.target.value)}
            rows={8}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     dark:bg-gray-700 dark:text-white font-mono"
            placeholder="Original/archive version (defaults to display lyrics)"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Saving...' : song ? 'Update Song' : 'Create Song'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
