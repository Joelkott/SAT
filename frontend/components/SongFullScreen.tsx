'use client';

import { Song } from '@/lib/api';
import { useEffect, useState } from 'react';

interface SongFullScreenProps {
  song: Song;
  onClose: () => void;
  onEdit: (song: Song) => void;
  onDelete: (songId: string) => Promise<boolean>;
}

export default function SongFullScreen({ song, onClose, onEdit, onDelete }: SongFullScreenProps) {
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  
  // Load alignment preference from localStorage
  useEffect(() => {
    const savedAlign = localStorage.getItem('lyrics-text-align');
    if (savedAlign === 'left' || savedAlign === 'center' || savedAlign === 'right') {
      setTextAlign(savedAlign);
    }
  }, []);
  // Close on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-95 flex flex-col">
      {/* Header with close button */}
      <div className="flex items-center justify-between p-6 border-b border-gray-700">
        <div className="flex-1">
          <h1 className="text-4xl font-bold text-white mb-2">{song.title}</h1>
          {song.artist && (
            <p className="text-gray-300 text-xl mb-2">{song.artist}</p>
          )}
          <span className="inline-block bg-blue-600 text-white text-sm font-semibold px-4 py-1 rounded-full">
            {song.language}
          </span>
        </div>
        <div className="flex gap-3 items-center">
          {/* Alignment Controls */}
          <div className="flex items-center gap-1 bg-gray-800/80 border border-gray-600 rounded-lg px-2 py-1 mr-2">
            <button
              onClick={() => {
                setTextAlign('left');
                localStorage.setItem('lyrics-text-align', 'left');
              }}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                textAlign === 'left' ? 'bg-blue-600 text-white' : 'text-white hover:bg-gray-700'
              }`}
              title="Align Left"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h14" />
              </svg>
            </button>
            <button
              onClick={() => {
                setTextAlign('center');
                localStorage.setItem('lyrics-text-align', 'center');
              }}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                textAlign === 'center' ? 'bg-blue-600 text-white' : 'text-white hover:bg-gray-700'
              }`}
              title="Align Center"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M5 18h14" />
              </svg>
            </button>
            <button
              onClick={() => {
                setTextAlign('right');
                localStorage.setItem('lyrics-text-align', 'right');
              }}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                textAlign === 'right' ? 'bg-blue-600 text-white' : 'text-white hover:bg-gray-700'
              }`}
              title="Align Right"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => onEdit(song)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              const deleted = await onDelete(song.id);
              if (deleted) {
                onClose();
              }
            }}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Close (ESC)
          </button>
        </div>
      </div>

      {/* Main content area - full screen lyrics */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          {/* Lyrics */}
          <div className="mb-8">
            <pre className={`whitespace-pre-wrap font-sans text-2xl leading-relaxed text-white text-${textAlign}`}>
              {song.lyrics}
            </pre>
          </div>

          {/* Full Content (if different from lyrics) */}
          {song.content && song.content !== song.lyrics && (
            <div className="mt-12 pt-8 border-t border-gray-700">
              <h2 className="text-xl font-semibold text-gray-400 mb-4 uppercase tracking-wide">
                Full Content
              </h2>
              <pre className="whitespace-pre-wrap font-sans text-xl leading-relaxed text-gray-300">
                {song.content}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Footer with metadata */}
      <div className="p-4 border-t border-gray-700 bg-gray-900 bg-opacity-50">
        <div className="max-w-5xl mx-auto flex justify-between items-center text-sm text-gray-400">
          <div>
            Created: {new Date(song.created_at).toLocaleDateString()}
          </div>
          <div>
            Last Updated: {new Date(song.updated_at).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

