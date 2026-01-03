'use client';

import { Song } from '@/lib/api';

interface SongListProps {
  songs: Song[];
  onSelectSong: (song: Song) => void;
  selectedSongId?: string;
  loading?: boolean;
  onEdit?: (song: Song) => void;
  onSendToLive?: (song: Song) => void;
  onAddToQueue?: (song: Song) => void;
  queuedSongIds?: Set<string>;
}

export default function SongList({ songs, onSelectSong, selectedSongId, loading, onEdit, onSendToLive, onAddToQueue, queuedSongIds }: SongListProps) {
  if (loading) {
    return (
      <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-6 text-center">
        <p className="text-gray-400">Loading songs...</p>
      </div>
    );
  }

  if (!songs || songs.length === 0) {
    return (
      <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-6 text-center">
        <p className="text-gray-400">No songs found</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] overflow-hidden">
      <div className="divide-y divide-[#2a2c31] max-h-[540px] overflow-y-auto">
        {songs.map((song) => (
          <div
            key={song.id}
            className={`w-full text-left p-4 flex items-start gap-3 hover:bg-[#1f2024] transition-colors ${
              selectedSongId === song.id ? 'bg-[#2a2c31]' : ''
            }`}
          >
            <div
              className="flex-1 min-w-0"
              onClick={() => onSelectSong(song)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelectSong(song);
                }
              }}
            >
              <h3 className="font-semibold text-white mb-1 truncate">
                {song.title}
              </h3>
              {song.artist && (
                <p className="text-sm text-gray-400 mb-1 truncate">
                  {song.artist}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="bg-gray-800 text-gray-200 px-2 py-1 rounded flex-shrink-0">
                  {song.language || 'Unknown'}
                </span>
                <span className="text-gray-500 truncate">
                  {song.music_ministry_lyrics ? song.music_ministry_lyrics.substring(0, 50) + '...' : 'No lyrics'}
                </span>
              </div>
            </div>

            <div className="flex gap-1 flex-shrink-0">
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(song);
                  }}
                  className="p-1.5 rounded-md border border-[#2a2c31] text-gray-300 hover:text-gray-100 hover:border-[#3a3c42] transition-colors text-sm"
                  aria-label={`Edit ${song.title}`}
                >
                  ✏
                </button>
              )}
              {onAddToQueue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToQueue(song);
                  }}
                  disabled={queuedSongIds?.has(song.id)}
                  className={`p-1.5 rounded-md border transition-colors text-sm ${
                    queuedSongIds?.has(song.id)
                      ? 'border-gray-700 text-gray-600 cursor-not-allowed opacity-40'
                      : 'border-[#2a2c31] text-gray-300 hover:text-gray-100 hover:border-[#3a3c42]'
                  }`}
                  aria-label={`Add ${song.title} to queue`}
                  title={queuedSongIds?.has(song.id) ? 'Already in queue' : 'Add to queue'}
                >
                  +
                </button>
              )}
              {onSendToLive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToLive(song);
                  }}
                  className="p-1.5 rounded-md border border-green-600/50 text-green-400 hover:text-green-300 hover:border-green-500 transition-colors text-sm"
                  aria-label={`Send ${song.title} to live`}
                  title="Send to Live"
                >
                  ▶
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
