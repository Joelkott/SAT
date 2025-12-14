'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus } from '@/lib/api';
import SearchBar from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';

export default function Home() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [liveSong, setLiveSong] = useState<Song | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewSong, setPreviewSong] = useState<Song | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [ppStatus, setPpStatus] = useState<ProPresenterStatus | null>(null);
  const [ppSyncing, setPpSyncing] = useState(false);
  const [ppSyncEnabled, setPpSyncEnabled] = useState(true);
  const [ppPlaylistName, setPpPlaylistName] = useState('Live Queue');
  const [ppThemeName, setPpThemeName] = useState('');
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  const [leftWidth, setLeftWidth] = useState(0.6);
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const leftWidthRef = useRef(0.6);
  const rafIdRef = useRef<number | null>(null);
  
  // Load alignment preference from localStorage
  useEffect(() => {
    const savedAlign = localStorage.getItem('lyrics-text-align');
    if (savedAlign === 'left' || savedAlign === 'center' || savedAlign === 'right') {
      setTextAlign(savedAlign);
    }
    
    // Load ProPresenter preferences
    const savedPlaylist = localStorage.getItem('pp-playlist-name');
    if (savedPlaylist) {
      setPpPlaylistName(savedPlaylist);
    }
    
    const savedTheme = localStorage.getItem('pp-theme-name');
    if (savedTheme) {
      setPpThemeName(savedTheme);
    }
    
    const savedSyncEnabled = localStorage.getItem('pp-sync-enabled');
    if (savedSyncEnabled !== null) {
      setPpSyncEnabled(savedSyncEnabled === 'true');
    }
  }, []);

  // Load all songs on mount
  useEffect(() => {
    loadSongs();
    checkProPresenterStatus();
  }, []);

  // Check ProPresenter connection status
  const checkProPresenterStatus = async () => {
    try {
      const status = await propresenterApi.getStatus();
      setPpStatus(status);
    } catch {
      setPpStatus({ enabled: false, connected: false, message: 'Failed to check status' });
    }
  };

  // Load splitter width from storage
  useEffect(() => {
    const saved = localStorage.getItem('control-splitter-width');
    if (saved) {
      const val = Number(saved);
      if (!Number.isNaN(val) && val > 0.3 && val < 0.8) {
        setLeftWidth(val);
        leftWidthRef.current = val;
      }
    }
  }, []);

  // Splitter drag handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      const clamped = Math.min(0.75, Math.max(0.35, pos));
      leftWidthRef.current = clamped;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          setLeftWidth(leftWidthRef.current);
          rafIdRef.current = null;
        });
      }
    };
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('control-splitter-width', String(leftWidthRef.current));
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setLeftWidth(leftWidthRef.current);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, leftWidth]);

  // Init broadcast channel for display window
  useEffect(() => {
    const channel = new BroadcastChannel('lyrics-display');
    displayChannelRef.current = channel;
    return () => {
      channel.close();
      displayChannelRef.current = null;
    };
  }, []);
  
  // Send zoom level whenever it changes
  useEffect(() => {
    if (displayChannelRef.current && selectedSong) {
      displayChannelRef.current.postMessage({
        type: 'zoom',
        zoomLevel: zoomLevel,
      });
    }
  }, [zoomLevel, selectedSong]);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const allSongs = await songsApi.getAll();
      setSongs(allSongs);
    } catch (error) {
      console.error('Error loading songs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(async (query: string, languages: string[]) => {
    const trimmed = query.trim();
    const hasLanguages = languages.length > 0;

    setSelectedLanguages(languages);

    // If no query and no languages, reset to all songs.
    if (!trimmed && !hasLanguages) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    const effectiveQuery = trimmed || '*';

    try {
      setIsSearching(true);
      const results = await songsApi.search(effectiveQuery, languages);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSelectSong = (song: Song) => {
    setPreviewSong(song);
    setShowPreviewModal(true);
  };

  const handleSendToLive = async (song: Song) => {
    setLiveSong(song);
    setSelectedSong(song);
    setShowPreviewModal(false);
    // reset splitter on live change
    leftWidthRef.current = 0.6;
    setLeftWidth(0.6);
    localStorage.setItem('control-splitter-width', String(0.6));
    
    const payload = {
      type: 'song',
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        lyrics: song.lyrics,
        content: song.content,
        language: song.language,
      },
    };
    localStorage.setItem('lyrics-display-current', JSON.stringify(payload.song));
    displayChannelRef.current?.postMessage(payload);
    
    // Also send current zoom level when song changes
    if (displayChannelRef.current) {
      displayChannelRef.current.postMessage({
        type: 'zoom',
        zoomLevel: zoomLevel,
      });
    }

    // Sync with ProPresenter if enabled
    if (ppSyncEnabled) {
      setPpSyncing(true);
      try {
        // Always try to sync - check status first if not already known
        if (!ppStatus || !ppStatus.connected) {
          const status = await propresenterApi.getStatus();
          setPpStatus(status);
          if (!status.connected) {
            console.warn('ProPresenter not connected, but attempting sync anyway...');
          }
        }
        
        const result = await propresenterApi.sendToQueue(song.id, song.title, ppPlaylistName, ppThemeName || undefined);
        console.log('✅ ProPresenter sync successful:', result);
      } catch (err: any) {
        console.error('❌ Failed to sync with ProPresenter:', err);
        // Show user-friendly error
        const errorMessage = err?.response?.data?.message || err?.message || 'Unknown error';
        alert(`ProPresenter sync failed: ${errorMessage}`);
      } finally {
        setPpSyncing(false);
      }
    }
  };

  const handleCreateNew = () => {
    setEditingSong(null);
    setShowForm(true);
  };

  const handleEdit = (song: Song) => {
    setEditingSong(song);
    setShowForm(true);
  };

  const handleDelete = async (songId: string) => {
    if (!confirm('Are you sure you want to delete this song?')) return false;

    try {
      await songsApi.delete(songId);
      await loadSongs();
      if (selectedSong?.id === songId) {
        setSelectedSong(null);
        localStorage.removeItem('lyrics-display-current');
        displayChannelRef.current?.postMessage({ type: 'clear' });
      }
      return true;
    } catch (error) {
      console.error('Error deleting song:', error);
      alert('Failed to delete song');
      return false;
    }
  };

  const handleFormSubmit = async () => {
    setShowForm(false);
    const editedSongId = editingSong?.id;
    setEditingSong(null);
    await loadSongs();
    
    // If the edited song was the live song, update it
    if (editedSongId && liveSong?.id === editedSongId) {
      const updatedSongs = await songsApi.getAll();
      const updatedSong = updatedSongs.find(s => s.id === editedSongId);
      if (updatedSong) {
        handleSendToLive(updatedSong);
      }
    }
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingSong(null);
  };

  const reorderByLanguageClient = (items: Song[], langs: string[]) => {
    if (!langs.length) return items;
    const prefs = langs.map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (!prefs.length) return items;

    const buckets: Record<string, Song[]> = {};
    const other: Song[] = [];

    items.forEach((s) => {
      const lang = (s.language || '').trim().toLowerCase();
      if (prefs.includes(lang)) {
        if (!buckets[lang]) buckets[lang] = [];
        buckets[lang].push(s);
      } else {
        other.push(s);
      }
    });

    const ordered: Song[] = [];
    prefs.forEach((p) => {
      if (buckets[p]) ordered.push(...buckets[p]);
    });
    ordered.push(...other);
    return ordered;
  };

  const displaySongs = searchResults
    ? reorderByLanguageClient(searchResults.songs, selectedLanguages)
    : songs;

  const handleCloseFullScreen = () => {
    setSelectedSong(null);
    localStorage.removeItem('lyrics-display-current');
    displayChannelRef.current?.postMessage({ type: 'clear' });
  };

  return (
    <>
      {selectedSong && isFullScreen && (
        <SongFullScreen
          song={selectedSong}
          onClose={() => setIsFullScreen(false)}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-gray-900 rounded-xl border border-gray-800 shadow-2xl w-full max-w-3xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white">
                {editingSong ? 'Edit Song' : 'Add New Song'}
              </h2>
              <button
                onClick={handleFormCancel}
                className="text-gray-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
            <SongForm
              song={editingSong}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </div>
        </div>
      )}

      {showPreviewModal && previewSong && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] shadow-2xl w-full max-w-5xl flex flex-col aspect-video overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2c31] flex-shrink-0">
              <div className="flex-1">
                <h1 className="text-xl font-bold text-white mb-1">{previewSong.title}</h1>
                {previewSong.artist && (
                  <p className="text-gray-300 text-sm mb-1">{previewSong.artist}</p>
                )}
                <span className="inline-block bg-blue-600 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
                  {previewSong.language}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingSong(previewSong);
                    setShowPreviewModal(false);
                    setShowForm(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-4 rounded-md transition-colors text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleSendToLive(previewSong)}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold py-1.5 px-4 rounded-md transition-colors text-sm"
                >
                  Send to Live
                </button>
                <button
                  onClick={() => {
                    setShowPreviewModal(false);
                    setPreviewSong(null);
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1.5 px-4 rounded-md transition-colors text-sm"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-black p-4 sm:p-6">
              <div className="max-w-4xl mx-auto">
                <pre className="whitespace-pre-wrap font-sans text-base sm:text-lg leading-relaxed text-white text-center">
                  {previewSong.lyrics}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-[#111214] text-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <SearchBar onSearch={handleSearch} />
            </div>
            <button
              onClick={handleCreateNew}
              aria-label="Add new song"
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-md bg-[#1a1b1f] border border-[#2a2c31] text-gray-100 hover:border-[#3a3c42] transition-colors text-xl leading-none"
            >
              ＋
            </button>
          </div>

          {isSearching && searchResults && (
            <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-3">
              <p className="text-sm text-gray-300">
                Found {searchResults.total_found} results in {searchResults.search_time_ms}ms
              </p>
            </div>
          )}

          <div
            ref={splitContainerRef}
            className="flex w-full gap-4"
            style={{ minHeight: '60vh' }}
          >
            {/* Left - Search results */}
            <div
              className="space-y-3"
              style={{ flexBasis: `${leftWidth * 100}%`, minWidth: '35%' }}
            >
              <SongList
                songs={displaySongs}
                onSelectSong={handleSelectSong}
                onEdit={handleEdit}
                onSendToLive={handleSendToLive}
                selectedSongId={selectedSong?.id}
                loading={loading}
              />
            </div>

            {/* Splitter */}
            <div
              className="w-2 sm:w-3 bg-[#2a2c31] hover:bg-[#3a3c42] rounded border border-[#2a2c31] cursor-col-resize select-none"
              style={{ minHeight: '100%', cursor: 'col-resize' }}
              onMouseDown={() => {
                setIsDragging(true);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            ></div>

            {/* Right - Live, Queue & Preview */}
            <div
              className="space-y-4"
              style={{ flexBasis: `${(1 - leftWidth) * 100}%`, minWidth: '25%' }}
            >
              {/* Live Song Tile */}
              <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4 space-y-3">
                <div className="text-xs font-semibold text-gray-400 uppercase">Live</div>
                <div className="bg-[#141518] rounded-lg p-3 flex items-center gap-3 border border-[#2a2c31]">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                  <div className="flex-1">
                    <div className="text-gray-100 font-semibold">
                      {liveSong ? liveSong.title : 'No song live'}
                    </div>
                    {liveSong?.artist && (
                      <div className="text-sm text-gray-400">
                        {liveSong.artist}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      window.open('/display', '_blank', 'noopener,noreferrer');
                    }}
                    className="px-3 py-2 rounded-md border border-[#3a3c42] text-gray-200 hover:border-gray-100 transition-colors text-sm"
                  >
                    Launch Live
                  </button>
                </div>
              </div>

              {/* ProPresenter Integration */}
              <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-gray-400 uppercase">ProPresenter</div>
                  <button
                    onClick={() => checkProPresenterStatus()}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    title="Refresh status"
                  >
                    ↻
                  </button>
                </div>
                <div className="bg-[#141518] rounded-lg p-3 flex items-center gap-3 border border-[#2a2c31]">
                  <div className={`w-3 h-3 rounded-full ${
                    ppStatus?.connected 
                      ? 'bg-green-500' 
                      : ppStatus?.enabled 
                        ? 'bg-yellow-500' 
                        : 'bg-gray-500'
                  }`}></div>
                  <div className="flex-1">
                    <div className="text-gray-100 text-sm font-medium">
                      {ppStatus?.connected 
                        ? 'Connected' 
                        : ppStatus?.enabled 
                          ? 'Disconnected' 
                          : 'Not Configured'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {ppSyncing 
                      ? 'Syncing...' 
                      : ppStatus?.connected 
                        ? 'Auto-sync enabled' 
                        : ppStatus?.enabled 
                          ? `Not connected: ${ppStatus.message || 'Unknown'}` 
                          : 'Auto-sync disabled'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const newState = !ppSyncEnabled;
                      setPpSyncEnabled(newState);
                      localStorage.setItem('pp-sync-enabled', String(newState));
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      ppSyncEnabled 
                        ? 'bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30' 
                        : 'bg-gray-700 text-gray-400 border border-gray-600 hover:bg-gray-600'
                    }`}
                    disabled={!ppStatus?.connected}
                    title={ppSyncEnabled ? 'Click to disable auto-sync' : 'Click to enable auto-sync'}
                  >
                    {ppSyncEnabled ? 'Sync On' : 'Sync Off'}
                  </button>
                </div>
                {ppStatus?.connected && (
                  <div className="bg-[#141518] rounded-lg p-3 border border-[#2a2c31] space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-2">Playlist Name</label>
                      <input
                        type="text"
                        value={ppPlaylistName}
                        onChange={(e) => {
                          setPpPlaylistName(e.target.value);
                          localStorage.setItem('pp-playlist-name', e.target.value);
                        }}
                        className="w-full bg-[#1a1b1f] border border-[#2a2c31] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Live Queue"
                        disabled={!ppSyncEnabled}
                      />
                      <div className="text-xs text-gray-600 mt-1">
                        Songs auto-added to this playlist
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-xs text-gray-500 mb-2">Theme Name (Optional)</label>
                      <input
                        type="text"
                        value={ppThemeName}
                        onChange={(e) => {
                          setPpThemeName(e.target.value);
                          localStorage.setItem('pp-theme-name', e.target.value);
                        }}
                        className="w-full bg-[#1a1b1f] border border-[#2a2c31] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Leave empty for default"
                        disabled={!ppSyncEnabled}
                      />
                      <div className="text-xs text-gray-600 mt-1">
                        Theme applied to songs in ProPresenter
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Queue & Preview */}
              <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4 space-y-3">
                <div className="bg-[#141518] rounded-lg p-3 flex items-center gap-3 border border-[#2a2c31]">
                  <div className="w-12 h-12 rounded bg-[#1f2024] flex items-center justify-center text-gray-300">
                    🎵
                  </div>
                  <div className="flex-1 text-gray-300 text-sm font-semibold">
                    Preview
                  </div>
                  {selectedSong && (
                    <div className="flex items-center gap-2">
                      {/* Text Alignment Controls */}
                      <div className="flex items-center gap-1 bg-[#1a1b1f] px-2 py-1 rounded-md border border-[#2a2c31]">
                        <button
                          onClick={() => {
                            setTextAlign('left');
                            localStorage.setItem('lyrics-text-align', 'left');
                            displayChannelRef.current?.postMessage({
                              type: 'alignment',
                              textAlign: 'left',
                            });
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                            textAlign === 'left' ? 'bg-blue-600 text-white border border-blue-500' : 'border border-[#3a3c42] bg-[#1a1b1f] text-white hover:border-gray-100 hover:bg-[#2a2c31]'
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
                            displayChannelRef.current?.postMessage({
                              type: 'alignment',
                              textAlign: 'center',
                            });
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                            textAlign === 'center' ? 'bg-blue-600 text-white border border-blue-500' : 'border border-[#3a3c42] bg-[#1a1b1f] text-white hover:border-gray-100 hover:bg-[#2a2c31]'
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
                            displayChannelRef.current?.postMessage({
                              type: 'alignment',
                              textAlign: 'right',
                            });
                          }}
                          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                            textAlign === 'right' ? 'bg-blue-600 text-white border border-blue-500' : 'border border-[#3a3c42] bg-[#1a1b1f] text-white hover:border-gray-100 hover:bg-[#2a2c31]'
                          }`}
                          title="Align Right"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
                          </svg>
                        </button>
                      </div>

                      {/* Zoom Controls */}
                      <div className="flex items-center gap-1.5 bg-[#1a1b1f] px-2 py-1 rounded-md border border-[#2a2c31]">
                        <button
                          onClick={() => {
                            const newZoom = Math.max(0.3, zoomLevel - 0.1);
                            setZoomLevel(newZoom);
                            displayChannelRef.current?.postMessage({
                              type: 'zoom',
                              zoomLevel: newZoom,
                            });
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded border border-[#3a3c42] bg-[#1a1b1f] text-white hover:border-gray-100 hover:bg-[#2a2c31] transition-colors text-base font-bold leading-none"
                          aria-label="Zoom out"
                        >
                          −
                        </button>
                        <span className="text-xs text-gray-300 min-w-[2.5rem] text-center">
                          {Math.round(zoomLevel * 100)}%
                        </span>
                        <button
                          onClick={() => {
                            const newZoom = Math.min(10.0, zoomLevel + 0.1);
                            setZoomLevel(newZoom);
                            displayChannelRef.current?.postMessage({
                              type: 'zoom',
                              zoomLevel: newZoom,
                            });
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded border border-[#3a3c42] bg-[#1a1b1f] text-white hover:border-gray-100 hover:bg-[#2a2c31] transition-colors text-base font-bold leading-none"
                          aria-label="Zoom in"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-center overflow-hidden" style={{ minHeight: '150%' }}>
                  <div className="bg-black rounded-lg border border-[#2a2c31] overflow-hidden flex flex-col aspect-video w-full" style={{ transform: 'scale(1.8)', transformOrigin: 'top center', maxWidth: '100%' }}>
                  {selectedSong ? (
                    <div
                      id="preview-scroll-container"
                      className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 lg:p-12"
                      onScroll={(e) => {
                        if (!displayChannelRef.current) return;
                        
                        const target = e.currentTarget;
                        const scrollTop = target.scrollTop;
                        const scrollHeight = target.scrollHeight;
                        const clientHeight = target.clientHeight;
                        const maxScroll = scrollHeight - clientHeight;
                        
                        if (maxScroll > 0) {
                          const scrollPercent = Math.max(0, Math.min(1, scrollTop / maxScroll));
                          try {
                            displayChannelRef.current.postMessage({
                              type: 'scroll',
                              scrollPercent: scrollPercent,
                            });
                          } catch (err) {
                            console.error('Error sending scroll message:', err);
                          }
                        }
                      }}
                    >
                      <div className="w-full max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto">
                        <div className="flex items-center min-h-full py-8">
                          <pre 
                            className={`whitespace-pre-wrap text-${textAlign} w-full leading-relaxed text-white`}
                            style={{ fontSize: `${0.875 * zoomLevel}rem` }}
                          >
                            {selectedSong.lyrics}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-gray-500 text-center text-xs sm:text-sm">Select a song to preview lyrics</p>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
