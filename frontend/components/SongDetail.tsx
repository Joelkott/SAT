'use client';

import { Song } from '@/lib/api';

interface SongDetailProps {
  song: Song;
  onEdit: (song: Song) => void;
  onDelete: (songId: string) => void;
}

export default function SongDetail({ song, onEdit, onDelete }: SongDetailProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-8">
        <h2 className="text-3xl font-bold text-white mb-2">{song.title}</h2>
        {song.artist && (
          <p className="text-blue-100 text-lg">{song.artist}</p>
        )}
        <div className="mt-3">
          <span className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
            {song.language}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Music Ministry Lyrics (shown to user) */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
            Music Ministry Lyrics
          </h3>
          <div className="bg-gray-50 dark:bg-gray-900 p-6 rounded-lg max-h-[600px] overflow-y-auto">
            <pre className="whitespace-pre-wrap font-sans text-lg leading-relaxed text-gray-900 dark:text-white">
              {song.music_ministry_lyrics}
            </pre>
          </div>
        </div>

        {/* Display Lyrics (for ProPresenter, if different) */}
        {song.display_lyrics && song.display_lyrics !== song.music_ministry_lyrics && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
              Display Lyrics (ProPresenter)
            </h3>
            <div className="bg-gray-50 dark:bg-gray-900 p-6 rounded-lg max-h-[600px] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-gray-900 dark:text-white">
                {song.display_lyrics}
              </pre>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Created</dt>
              <dd className="text-gray-900 dark:text-white mt-1">
                {new Date(song.created_at).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Last Updated</dt>
              <dd className="text-gray-900 dark:text-white mt-1">
                {new Date(song.updated_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onEdit(song)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Edit Song
          </button>
          <button
            onClick={() => onDelete(song.id)}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Delete Song
          </button>
        </div>
      </div>
    </div>
  );
}
