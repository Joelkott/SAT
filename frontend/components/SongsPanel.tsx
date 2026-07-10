'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus } from '@/lib/api';
import SearchBar from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';
import QueuePanel from '@/components/QueuePanel';
import { PlusIcon, MinusIcon, MusicIcon, MonitorIcon, RefreshIcon, XIcon } from '@/components/icons';

export default function SongsPanel() {
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
  const [ppStatus, setPpStatus] = useState<ProPresenterStatus | null>(null);
  const [ppSyncing, setPpSyncing] = useState(false);
  const [ppSyncEnabled, setPpSyncEnabled] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [hoverSong, setHoverSong] = useState<Song | null>(null);
  const [role, setRoleState] = useState('');
  useEffect(() => { setRoleState(localStorage.getItem('sat-role') || ''); }, []);
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  const [leftWidth, setLeftWidth] = useState(0.6);
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const leftWidthRef = useRef(0.6);
  const rafIdRef = useRef<number | null>(null);

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
    } catch (error: any) {
      console.error('Error loading songs:', error);
      console.error('Error details:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        config: error?.config,
      });
      // Show user-friendly error
      alert(`Failed to load songs: ${error?.response?.data?.error || error?.message || 'Unknown error'}`);
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
        display_lyrics: song.display_lyrics,
        music_ministry_lyrics: song.music_ministry_lyrics,
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

    // Sync with ProPresenter if enabled and connected
    if (ppSyncEnabled && ppStatus?.connected) {
      setPpSyncing(true);
      try {
        await propresenterApi.sendToQueue(song.id, song.title);
      } catch (err) {
        console.error('Failed to sync with ProPresenter:', err);
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
          <div className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-3xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-ink">
                {editingSong ? 'Edit Song' : 'Add New Song'}
              </h2>
              <button
                onClick={handleFormCancel}
                aria-label="Close"
                className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
              >
                <XIcon className="w-4 h-4" />
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
          <div className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-5xl flex flex-col aspect-video overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-edge flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-ink mb-1 truncate">{previewSong.title}</h1>
                {previewSong.artist && (
                  <p className="text-ink-dim text-sm mb-1.5 truncate">{previewSong.artist}</p>
                )}
                <span className="inline-block bg-surface-sunken border border-edge text-ink-dim text-xs font-medium px-2.5 py-0.5 rounded-full capitalize">
                  {previewSong.language}
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => {
                    setEditingSong(previewSong);
                    setShowPreviewModal(false);
                    setShowForm(true);
                  }}
                  className="border border-edge-strong text-ink-dim hover:text-ink hover:border-accent font-medium py-1.5 px-4 rounded-md cursor-pointer transition-colors duration-150 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleSendToLive(previewSong)}
                  className="bg-ok/90 hover:bg-ok text-on-accent font-semibold py-1.5 px-4 rounded-md cursor-pointer transition-colors duration-150 text-sm"
                >
                  Send to Live
                </button>
                <button
                  onClick={() => {
                    setShowPreviewModal(false);
                    setPreviewSong(null);
                  }}
                  aria-label="Close preview"
                  className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-black p-4 sm:p-6">
              <div className="max-w-4xl mx-auto">
                <pre className={`whitespace-pre-wrap font-sans text-base sm:text-lg text-white text-center ${
                  ['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'].includes((previewSong.language || '').toLowerCase())
                    ? 'script-indic'
                    : 'leading-relaxed'
                }`}>
                  {previewSong.display_lyrics}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`${queueOpen ? 'w-full' : 'max-w-7xl mx-auto'} px-6 py-6 flex gap-5 items-start`}>
        {/* Queue pushes content right instead of overlaying it */}
        {queueOpen && (
          <div className="w-[300px] shrink-0 self-stretch sticky top-20 max-h-[calc(100vh-120px)]">
            <QueuePanel
              isOpen={queueOpen}
              onToggle={() => setQueueOpen(false)}
              onSongSelect={(song) => handleSendToLive(song)}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <SearchBar onSearch={handleSearch} />
          </div>
          <button
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            title={queueOpen ? 'Hide queue' : 'Show song queue'}
            className={`shrink-0 h-[46px] px-4 flex items-center gap-2 rounded-lg border cursor-pointer text-sm font-medium ${
              queueOpen
                ? 'bg-accent/15 border-accent/50 text-accent-hover'
                : 'bg-surface-raised border-edge text-ink-dim hover:text-ink hover:border-accent'
            }`}
          >
            <MusicIcon className="w-4 h-4" />
            Queue
          </button>
          <button
            onClick={handleCreateNew}
            aria-label="Add new song"
            title="Add new song"
            className="shrink-0 h-[46px] w-[46px] flex items-center justify-center rounded-lg bg-accent-deep hover:bg-accent text-on-accent cursor-pointer transition-colors duration-150"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        </div>

        {isSearching && searchResults && (
          <div className="bg-surface-raised rounded-lg border border-edge px-3 py-2">
            <p className="text-sm text-ink-dim">
              Found <span className="text-ink font-medium">{searchResults.total_found}</span> results in {searchResults.search_time_ms}ms
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
              onHover={setHoverSong}
              selectedSongId={selectedSong?.id}
              loading={loading}
            />
          </div>

          {/* Splitter */}
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1.5 bg-edge hover:bg-accent/60 rounded-full cursor-col-resize select-none transition-colors duration-150"
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
            <div className="bg-surface-raised rounded-xl border border-edge p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${liveSong ? 'bg-live animate-pulse' : 'bg-edge-strong'}`} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${liveSong ? 'text-live' : 'text-ink-mute'}`}>
                  Live
                </span>
              </div>
              <div className="bg-surface-sunken rounded-lg p-3 flex items-center gap-3 border border-edge">
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold truncate ${liveSong ? 'text-ink' : 'text-ink-mute'}`}>
                    {liveSong ? liveSong.title : 'No song live'}
                  </div>
                  {liveSong?.artist && (
                    <div className="text-sm text-ink-mute truncate">
                      {liveSong.artist}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ProPresenter Integration (not shown to worship) */}
            {role !== 'worship' && (
            <div className="bg-surface-raised rounded-xl border border-edge p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider">ProPresenter</div>
                <button
                  onClick={() => checkProPresenterStatus()}
                  className="p-1.5 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
                  title="Refresh status"
                  aria-label="Refresh ProPresenter status"
                >
                  <RefreshIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="bg-surface-sunken rounded-lg p-3 flex items-center gap-3 border border-edge">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  ppStatus?.connected
                    ? 'bg-ok'
                    : ppStatus?.enabled
                      ? 'bg-warn'
                      : 'bg-edge-strong'
                }`}></div>
                <div className="flex-1 min-w-0">
                  <div className="text-ink text-sm font-medium">
                    {ppStatus?.connected
                      ? 'Connected'
                      : ppStatus?.enabled
                        ? 'Disconnected'
                        : 'Not configured'}
                  </div>
                  <div className="text-xs text-ink-mute">
                    {ppSyncing ? 'Syncing...' : ppSyncEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled'}
                  </div>
                </div>
                <button
                  onClick={() => setPpSyncEnabled(!ppSyncEnabled)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                    ppSyncEnabled
                      ? 'bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25'
                      : 'bg-surface-hover text-ink-mute border border-edge-strong hover:text-ink-dim'
                  }`}
                  disabled={!ppStatus?.connected}
                  title={ppSyncEnabled ? 'Click to disable auto-sync' : 'Click to enable auto-sync'}
                >
                  {ppSyncEnabled ? 'Sync on' : 'Sync off'}
                </button>
              </div>
              {ppStatus?.connected && liveSong && (
                <div className="text-xs text-ink-mute px-1">
                  Songs sent to &quot;Live Queue&quot; playlist in ProPresenter
                </div>
              )}
            </div>
            )}

            {/* Queue & Preview */}
            <div className="bg-surface-raised rounded-xl border border-edge p-4 space-y-3">
              <div className="bg-surface-sunken rounded-lg p-3 flex items-center gap-3 border border-edge">
                <div className="w-10 h-10 rounded-lg bg-surface-hover border border-edge flex items-center justify-center text-ink-mute">
                  <MusicIcon className="w-5 h-5" />
                </div>
                <div className="flex-1 text-ink-dim text-sm font-semibold">
                  Preview
                </div>
                {selectedSong && (
                  <div className="flex items-center gap-2">
                    {/* Zoom Controls */}
                    <div className="flex items-center gap-1 bg-surface-raised px-1.5 py-1 rounded-md border border-edge">
                      <button
                        onClick={() => {
                          const newZoom = Math.max(0.5, zoomLevel - 0.1);
                          setZoomLevel(newZoom);
                          displayChannelRef.current?.postMessage({
                            type: 'zoom',
                            zoomLevel: newZoom,
                          });
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
                        aria-label="Zoom out"
                      >
                        <MinusIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs text-ink-dim min-w-[2.5rem] text-center tabular-nums">
                        {Math.round(zoomLevel * 100)}%
                      </span>
                      <button
                        onClick={() => {
                          const newZoom = Math.min(3.0, zoomLevel + 0.1);
                          setZoomLevel(newZoom);
                          displayChannelRef.current?.postMessage({
                            type: 'zoom',
                            zoomLevel: newZoom,
                          });
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer transition-colors duration-150"
                        aria-label="Zoom in"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-hidden">
                <div className="bg-black rounded-lg border border-edge overflow-hidden flex flex-col aspect-video w-full">
                {(hoverSong || selectedSong) ? (
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
                    <div
                      className="w-full max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto"
                      style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}
                    >
                      <div className="flex items-center min-h-full py-8">
                        <pre className="whitespace-pre-wrap text-center w-full text-xs sm:text-sm md:text-base lg:text-lg xl:text-xl 2xl:text-2xl leading-relaxed text-white">
                          {(hoverSong || selectedSong)!.display_lyrics}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-ink-mute text-center text-xs sm:text-sm">Hover or select a song to preview it</p>
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
