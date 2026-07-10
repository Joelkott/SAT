'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus, queueApi } from '@/lib/api';
import SearchBar from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';
import QueuePanel from '@/components/QueuePanel';
import { PlusIcon, MinusIcon, MusicIcon, MonitorIcon, RefreshIcon, XIcon, PencilIcon, ChevronDownIcon, PlayIcon } from '@/components/icons';

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
  const [queueRefresh, setQueueRefresh] = useState(0);
  const [hoverSong, setHoverSong] = useState<Song | null>(null);
  const [role, setRoleState] = useState('');
  useEffect(() => { setRoleState(localStorage.getItem('sat-role') || ''); }, []);
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  const [leftWidth, setLeftWidth] = useState(0.6);
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const leftWidthRef = useRef(0.6);
  const rafIdRef = useRef<number | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewW, setPreviewW] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(1.0);
  const [liveFrac, setLiveFrac] = useState(0.55);
  const [liveCollapsed, setLiveCollapsed] = useState(false);
  useEffect(() => { setLiveCollapsed(localStorage.getItem('live-collapsed') === '1'); }, []);
  const toggleLiveCollapsed = () => {
    setLiveCollapsed((v) => { localStorage.setItem('live-collapsed', v ? '0' : '1'); return !v; });
  };
  const [inlineEdit, setInlineEdit] = useState(false);
  const [inlineDraft, setInlineDraft] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);

  const startInlineEdit = () => {
    const song = hoverSong || selectedSong;
    if (!song) return;
    setInlineDraft(song.display_lyrics);
    setInlineEdit(true);
  };

  const saveInlineEdit = async () => {
    const song = hoverSong || selectedSong;
    if (!song) return;
    try {
      setInlineSaving(true);
      await songsApi.update(song.id, { display_lyrics: inlineDraft });
      const updated = { ...song, display_lyrics: inlineDraft };
      if (hoverSong?.id === song.id) setHoverSong(updated);
      if (selectedSong?.id === song.id) setSelectedSong(updated);
      if (liveSong?.id === song.id) handleSendToLive(updated);
      await loadSongs();
      setInlineEdit(false);
    } catch (err) {
      console.error('Inline edit failed:', err);
    } finally {
      setInlineSaving(false);
    }
  };
  useEffect(() => {
    const saved = Number(localStorage.getItem('live-monitor-frac'));
    if (saved >= 0.4 && saved <= 1) setLiveFrac(saved);
  }, []);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewW(el.offsetWidth));
    ro.observe(el);
    setPreviewW(el.offsetWidth);
    return () => ro.disconnect();
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

  // Ctrl+Shift+L (Cmd+Shift+L on Mac) sends the previewed song to live
  const sendPreviewToLiveRef = useRef<() => void>(() => {});
  sendPreviewToLiveRef.current = () => {
    const song = hoverSong || selectedSong;
    if (song) handleSendToLive(song);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        e.preventDefault();
        sendPreviewToLiveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    setHoverSong(song);
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

  const handleAddToQueue = async (song: Song) => {
    try {
      await queueApi.add(song.id);
      setQueueRefresh((n) => n + 1);
    } catch (error: any) {
      console.error('Error adding song to queue:', error);
      alert(`Failed to add to queue: ${error?.response?.data?.error || error?.message || 'Unknown error'}`);
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
              onSongSelect={(song) => handleSelectSong(song)}
              onSendToLive={handleSendToLive}
              refreshToken={queueRefresh}
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
              onAddToQueue={handleAddToQueue}
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

            {/* Live monitor + song preview (drag divider to resize) */}
            <div className="bg-surface-raised rounded-xl border border-edge p-4 space-y-2">
              {/* LIVE — mirrors the display window; zoom here controls it */}
              {liveCollapsed ? (
                <button
                  onClick={toggleLiveCollapsed}
                  title="Expand live monitor"
                  className="w-full h-9 flex items-center justify-between px-3 rounded-lg bg-surface-sunken border border-edge cursor-pointer text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${liveSong ? 'bg-live animate-pulse' : 'bg-edge-strong'}`} />
                    <span className="font-bold tracking-widest text-live">LIVE</span>
                    <span className="text-ink-mute truncate max-w-[180px]">{liveSong ? liveSong.title : 'Nothing live'}</span>
                  </span>
                  <ChevronDownIcon className="w-3.5 h-3.5 text-ink-mute" />
                </button>
              ) : (
              <div style={{ width: `${liveFrac * 100}%` }} className="mx-auto relative">
                <button
                  onClick={toggleLiveCollapsed}
                  title="Collapse live monitor"
                  aria-label="Collapse live monitor"
                  className="absolute bottom-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-md bg-black/60 border border-edge text-ink-mute hover:text-ink cursor-pointer"
                >
                  <ChevronDownIcon className="w-3.5 h-3.5 rotate-180" />
                </button>
                <SongReplica
                  song={liveSong}
                  zoom={zoomLevel}
                  emptyText="Nothing live"
                  badge="LIVE"
                  badgeClass="text-live"
                  overlay={
                    <ZoomControls
                      value={zoomLevel}
                      onChange={(z) => {
                        setZoomLevel(z);
                        displayChannelRef.current?.postMessage({ type: 'zoom', zoomLevel: z });
                      }}
                    />
                  }
                />
              </div>
              )}

              {/* Divider: drag vertically to resize the live monitor */}
              {!liveCollapsed && (
              <div
                role="separator"
                aria-orientation="horizontal"
                title="Drag to resize the live monitor"
                className="h-1.5 mx-8 rounded-full bg-edge hover:bg-accent/60 cursor-row-resize"
                onPointerDown={(e) => {
                  const startY = e.clientY;
                  const startFrac = liveFrac;
                  const move = (ev: PointerEvent) => {
                    const f = Math.min(1, Math.max(0.4, startFrac + (ev.clientY - startY) / 300));
                    setLiveFrac(f);
                    localStorage.setItem('live-monitor-frac', String(f));
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              />
              )}

              {/* PREVIEW — hover/selected song, local zoom only */}
              {inlineEdit ? (
                <div className="bg-black rounded-lg border border-accent/50 overflow-hidden aspect-video w-full relative flex flex-col">
                  <textarea
                    value={inlineDraft}
                    onChange={(e) => setInlineDraft(e.target.value)}
                    autoFocus
                    className="flex-1 w-full bg-black text-white text-sm p-4 resize-none focus:outline-none font-sans text-center"
                  />
                  <div className="flex justify-end gap-2 p-2 border-t border-edge bg-surface-sunken">
                    <button
                      onClick={() => setInlineEdit(false)}
                      className="h-8 px-3 rounded-md text-ink-mute hover:text-ink cursor-pointer text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveInlineEdit}
                      disabled={inlineSaving}
                      className="h-8 px-3.5 rounded-md bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {inlineSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
              <SongReplica
                song={hoverSong || selectedSong}
                zoom={previewZoom}
                emptyText="Click a song to preview it"
                badge="PREVIEW"
                badgeClass="text-ink-mute"
                overlay={
                  <>
                    <button
                      onClick={() => (hoverSong || selectedSong) && handleSendToLive((hoverSong || selectedSong)!)}
                      className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ok cursor-pointer"
                      aria-label="Send previewed song to live"
                      title="Send to live (Ctrl+Shift+L)"
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-px h-4 bg-edge" aria-hidden />
                    <button
                      onClick={startInlineEdit}
                      className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ink cursor-pointer"
                      aria-label="Edit lyrics in preview"
                      title="Quick edit"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-px h-4 bg-edge" aria-hidden />
                    <ZoomControls value={previewZoom} onChange={setPreviewZoom} />
                  </>
                }
              />
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

// Compact zoom control cluster used by the preview panels.
function ZoomControls({ value, onChange }: { value: number; onChange: (z: number) => void }) {
  return (
    <>
      <button
        onClick={() => onChange(Math.max(0.5, value - 0.1))}
        className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ink cursor-pointer"
        aria-label="Zoom out"
      >
        <MinusIcon className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs text-ink-dim min-w-[2.5rem] text-center tabular-nums">
        {Math.round(value * 100)}%
      </span>
      <button
        onClick={() => onChange(Math.min(3.0, value + 0.1))}
        className="w-7 h-7 flex items-center justify-center rounded text-ink-dim hover:text-ink cursor-pointer"
        aria-label="Zoom in"
      >
        <PlusIcon className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

// Scaled 1920x1080 replica of the display window.
function SongReplica({ song, zoom, emptyText, badge, badgeClass, overlay }: {
  song: Song | null;
  zoom: number;
  emptyText: string;
  badge: string;
  badgeClass: string;
  overlay: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    setW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="bg-black rounded-lg border border-edge overflow-hidden aspect-video w-full relative">
      <span className={`absolute top-2 left-2 z-10 text-[10px] font-bold tracking-widest bg-black/60 px-1.5 py-0.5 rounded ${badgeClass}`}>
        {badge}
      </span>
      {song && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-1 rounded-md border border-edge">
          {overlay}
        </div>
      )}
      {song ? (
        <div
          className="absolute top-0 left-0 overflow-hidden"
          style={{ width: 1920, height: 1080, transform: `scale(${w / 1920})`, transformOrigin: 'top left' }}
        >
          <div className="h-full w-full overflow-y-auto p-12">
            <div className="min-h-full w-full flex items-center justify-center">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }} className="w-full">
                <pre className={`whitespace-pre-wrap text-center w-full text-5xl text-white ${['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'].includes((song.language || '').toLowerCase()) ? 'script-indic' : 'leading-relaxed'}`}>
                  {song.display_lyrics}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-ink-mute text-center text-xs sm:text-sm">{emptyText}</p>
        </div>
      )}
    </div>
  );
}