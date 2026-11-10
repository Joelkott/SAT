'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import type { ForwardedRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus, queueApi } from '@/lib/api';
import SearchBar from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';
import QueuePanel from '@/components/QueuePanel';
import { PlusIcon, MinusIcon, MusicIcon, MonitorIcon, RefreshIcon, XIcon, PencilIcon, ChevronDownIcon, PlayIcon, ClipboardIcon, CheckIcon, BellIcon } from '@/components/icons';
import { FormattedLyrics, LyricBlocks, toggleBoldInTextarea, useLyricSpacing, INDIC_EXTRA, stripBold } from '@/components/lyricsFormat';
import { useScrollMemory } from '@/lib/scrollMemory';
import { copyText } from '@/lib/clipboard';
import { useRole, isGuest } from '@/lib/role';
import { liveSongApi, PanelResult, songPingApi, SongPing } from '@/lib/remote';
import {
  DEFAULT_ALIGN,
  DEFAULT_FONT,
  FONT_OPTIONS,
  TextAlign,
  readAlign,
  readFontFamily,
  setAlign,
  setFontFamily,
} from '@/lib/displayPrefs';

// Imperative handle used by the control-window remote executor: every method
// reuses the panel's own handlers so remote commands get the same guards,
// BroadcastChannel messages and ProPresenter sync as a local click.
export interface SongsPanelHandle {
  sendSongLive(songId: string): Promise<PanelResult>;
  queueStep(dir: 1 | -1): Promise<PanelResult>;
  clearLive(): Promise<PanelResult>;
  queueAdd(songId: string): Promise<PanelResult>;
  queueRemove(queueItemId: number): Promise<PanelResult>;
  zoom(arg: { delta?: number; value?: number }): Promise<PanelResult>;
  scroll(dir: 1 | -1, amount: 'step' | 'page'): Promise<PanelResult>;
  refreshQueue(): void;
  republishLive(): void;
}

export interface SongsPanelProps {
  // Fires when a song-ping banner appears/disappears (page dots the Songs tab).
  onSongPingChange?: (active: boolean) => void;
}

function SongsPanel({ onSongPingChange }: SongsPanelProps, ref: ForwardedRef<SongsPanelHandle>) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [liveSong, setLiveSong] = useState<Song | null>(null);
  // Live song id, updated synchronously (two quick remote "next" commands must
  // see the new live id before React re-renders).
  const liveSongIdRef = useRef<string | null>(null);
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
  const [queueCount, setQueueCount] = useState(0);
  // Keep the queue-count badge current even while the panel is closed.
  useEffect(() => {
    let cancelled = false;
    queueApi
      .getAll()
      .then((items) => { if (!cancelled) setQueueCount(items.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queueRefresh]);
  const [hoverSong, setHoverSong] = useState<Song | null>(null);
  const role = useRole();
  // guest is view-only (see lib/role.ts): the backend 403s every write and all
  // of /api/propresenter/*, so the UI hides every write/projection control and
  // the handlers early-return via isGuest() (which reads localStorage directly,
  // so it is correct even before the role state settles).
  const readOnly = role === 'guest';
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
  // Quick-edit formatting: alignment and font are display-wide preferences, so
  // the toolbar previews them in the textarea and broadcasts them to /display.
  const [align, setAlignState] = useState<TextAlign>(DEFAULT_ALIGN);
  const [fontFamily, setFontFamilyState] = useState(DEFAULT_FONT);
  useEffect(() => {
    setAlignState(readAlign());
    setFontFamilyState(readFontFamily());
  }, []);
  const applyAlign = (a: TextAlign) => {
    setAlignState(a);
    setAlign(a, displayChannelRef.current);
  };
  const applyFontFamily = (f: string) => {
    setFontFamilyState(f);
    setFontFamily(f, displayChannelRef.current);
  };
  const inlineTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  // Inline save failure: shown next to Save; the draft stays in the editor.
  const [inlineError, setInlineError] = useState(false);

  // The song being inline-edited is pinned when the editor opens. Resolving
  // hoverSong/selectedSong again at save time wrote the draft into whichever
  // song the user clicked mid-edit, silently rewriting that other song.
  const [inlineEditSong, setInlineEditSong] = useState<Song | null>(null);

  const startInlineEdit = () => {
    if (isGuest()) return;
    const song = hoverSong || selectedSong;
    if (!song) return;
    setInlineEditSong(song);
    setInlineDraft(song.music_ministry_lyrics || song.display_lyrics);
    setInlineError(false);
    setInlineEdit(true);
  };

  const saveInlineEdit = async () => {
    const song = inlineEditSong;
    if (!song) return;
    try {
      setInlineSaving(true);
      setInlineError(false);
      await songsApi.update(song.id, { music_ministry_lyrics: inlineDraft });
      const updated = { ...song, music_ministry_lyrics: inlineDraft };
      if (hoverSong?.id === song.id) setHoverSong(updated);
      if (selectedSong?.id === song.id) setSelectedSong(updated);
      if (liveSong?.id === song.id) handleSendToLive(updated);
      await loadSongs();
      setInlineEdit(false);
      setInlineEditSong(null);
    } catch (err) {
      console.error('Inline edit failed:', err);
      setInlineError(true);
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
    // isGuest() reads localStorage rather than the `role` state: the mount
    // effect calls this before the role state has settled.
    if (isGuest()) {
      setPpStatus({ enabled: false, connected: false, message: 'Not available for this account' });
      return;
    }
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

  // Escape closes the preview modal.
  useEffect(() => {
    if (!showPreviewModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPreviewModal(false);
        setPreviewSong(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPreviewModal]);

  // Ctrl+Shift+L (Cmd+Shift+L on Mac) sends the previewed song to live
  const sendPreviewToLiveRef = useRef<() => void>(() => {});
  sendPreviewToLiveRef.current = () => {
    if (isGuest()) return;
    const song = hoverSong || selectedSong;
    if (song) handleSendToLive(song);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        e.preventDefault();
        sendPreviewToLiveRef.current();
        return;
      }
      // 1-9 loads that queue position into preview
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && !typing) {
        const idx = Number(e.key) - 1;
        queueApi
          .getAll()
          .then((items) => {
            const song = items[idx]?.song;
            if (song) setHoverSong(song);
          })
          .catch((err) => console.error('Failed to load queue item for shortcut:', err));
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

  const [loadError, setLoadError] = useState('');
  const loadSongs = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const allSongs = await songsApi.getAll();
      setSongs(allSongs);
    } catch (error: any) {
      console.error('Error loading songs:', error);
      setLoadError(error?.response?.data?.error || 'Could not load songs. Check the connection and try again.');
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
      setActionError('Search failed. Check the connection and try again.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Recency history: recently opened songs float to the top of the list.
  const [openHistory, setOpenHistory] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setOpenHistory(JSON.parse(localStorage.getItem('song-open-history') || '{}'));
    } catch {}
  }, []);
  const recordOpen = useCallback((songId: string) => {
    setOpenHistory((prev) => {
      const next = Object.fromEntries(
        Object.entries({ ...prev, [songId]: Date.now() })
          .sort((a, b) => b[1] - a[1])
          .slice(0, 300)
      );
      try {
        localStorage.setItem('song-open-history', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleSelectSong = useCallback((song: Song) => {
    setHoverSong(song);
    recordOpen(song.id);
  }, [recordOpen]);

  // Tell the backend what's live so phone viewers can follow it. Best-effort:
  // an older backend (404) or a network blip must never block the display.
  const publishLive = (song: Song | null) => {
    if (isGuest()) return;
    liveSongApi
      .publish(song ? { song_id: song.id, title: song.title, language: song.language || '' } : { cleared: true })
      .catch((err) => console.warn('Live song publish failed:', err?.response?.status || err?.message));
  };

  const handleSendToLive = useCallback(async (song: Song) => {
    // guest is view-only: never projects anything.
    if (isGuest()) return;
    recordOpen(song.id);
    liveSongIdRef.current = song.id;
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
    publishLive(song);

    // Also send current zoom level when song changes
    if (displayChannelRef.current) {
      displayChannelRef.current.postMessage({
        type: 'zoom',
        zoomLevel: zoomLevel,
      });
    }

    // Sync with ProPresenter if enabled and connected (never for guest).
    // Not awaited: the display has already changed, and a phone remote's
    // command is acked when this returns — it must not wait on ProPresenter.
    if (!isGuest() && ppSyncEnabled && ppStatus?.connected) {
      setPpSyncing(true);
      propresenterApi.sendToQueue(song.id, song.title)
        .catch((err) => {
          console.error('Failed to sync with ProPresenter:', err);
          setActionError('Sent to the display, but ProPresenter sync failed.');
        })
        .finally(() => setPpSyncing(false));
    }
  }, [recordOpen, zoomLevel, ppSyncEnabled, ppStatus?.connected]);

  // ProPresenter playlist reconcile: verify every queued song is in the live
  // playlist (leaving anything else in there untouched). Runs automatically
  // when sync is switched back on, since queue adds made while it was off
  // never reached ProPresenter.
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState('');
  const runReconcile = useCallback(async (silent: boolean) => {
    // Only reachable from the (hidden) ProPresenter card, but guard anyway —
    // the endpoint 403s for guest.
    if (isGuest()) return;
    setReconciling(true);
    if (!silent) setReconcileMsg('');
    try {
      const r = await propresenterApi.reconcile();
      const bits: string[] = [];
      if (r.added.length) bits.push(`added ${r.added.length}`);
      if (r.already_present) bits.push(`${r.already_present} already there`);
      if (r.skipped_no_pro_uuid.length) bits.push(`${r.skipped_no_pro_uuid.length} without a ProPresenter file`);
      setReconcileMsg(bits.length ? `${r.playlist}: ${bits.join(', ')}` : `${r.playlist}: nothing to add`);
    } catch (err: any) {
      console.error('ProPresenter reconcile failed:', err);
      setReconcileMsg(err?.response?.data?.error || 'Could not check the ProPresenter playlist');
    } finally {
      setReconciling(false);
    }
  }, []);

  const handleToggleSync = useCallback(() => {
    const next = !ppSyncEnabled;
    setPpSyncEnabled(next);
    // Re-enabling: catch the playlist up on anything queued while it was off.
    if (next && ppStatus?.connected) runReconcile(true);
  }, [ppSyncEnabled, ppStatus?.connected, runReconcile]);

  // Transient, non-blocking error strip for one-off actions (auto-dismisses).
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(''), 5000);
    return () => clearTimeout(t);
  }, [actionError]);

  const handleAddToQueue = useCallback(async (song: Song) => {
    if (isGuest()) return;
    try {
      await queueApi.add(song.id);
      setQueueRefresh((n) => n + 1);
    } catch (error: any) {
      console.error('Error adding song to queue:', error);
      setActionError(`Couldn't add "${song.title}" to the queue. Try again.`);
    }
  }, []);

  // ===== Song pings: another account's phone points this window at a song =====
  // The server hides stale pings and this account's own pings, so no client
  // username is needed. The first poll only baselines (no replay on load).
  const [songPing, setSongPing] = useState<SongPing | null>(null);
  const seenPingIdRef = useRef<string | null>(null);
  const pingBaselinedRef = useRef(false);
  const pingInFlightRef = useRef(false);
  useEffect(() => {
    if (role === '' || role === 'guest') return;
    let alive = true;
    const tick = async () => {
      if (pingInFlightRef.current) return;
      pingInFlightRef.current = true;
      try {
        const p = await songPingApi.latest();
        if (!alive) return;
        if (!pingBaselinedRef.current) {
          seenPingIdRef.current = p.id || '';
          pingBaselinedRef.current = true;
          return;
        }
        if (p.id && p.id !== seenPingIdRef.current) {
          seenPingIdRef.current = p.id;
          setSongPing(p);
        }
      } catch (err: any) {
        // Older backend (404) or a network blip: stay quiet.
        console.warn('Song ping poll failed:', err?.response?.status || err?.message);
      } finally {
        pingInFlightRef.current = false;
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [role]);

  useEffect(() => {
    if (!songPing) return;
    const t = setTimeout(() => setSongPing(null), 120000);
    return () => clearTimeout(t);
  }, [songPing]);

  const onSongPingChangeRef = useRef(onSongPingChange);
  onSongPingChangeRef.current = onSongPingChange;
  useEffect(() => {
    onSongPingChangeRef.current?.(!!songPing);
  }, [songPing]);

  const handlePingPreview = async () => {
    if (!songPing?.song_id) return;
    try {
      handleSelectSong(await songsApi.getById(songPing.song_id));
    } catch (error) {
      console.error('Error loading pinged song:', error);
      setActionError("Couldn't load that song.");
    }
  };

  const handlePingAddToQueue = async () => {
    if (!songPing?.song_id) return;
    try {
      await handleAddToQueue(await songsApi.getById(songPing.song_id));
      setSongPing(null);
    } catch (error) {
      console.error('Error loading pinged song:', error);
      setActionError("Couldn't load that song.");
    }
  };

  const handleCreateNew = () => {
    if (isGuest()) return;
    setEditingSong(null);
    setShowForm(true);
  };

  const handleEdit = useCallback((song: Song) => {
    if (isGuest()) return;
    setEditingSong(song);
    setShowForm(true);
  }, []);

  // Deletion is confirmed in the UI that calls this (no browser popups).
  const handleDelete = async (songId: string) => {
    if (isGuest()) return false;
    try {
      await songsApi.delete(songId);
      await loadSongs();
      setQueueRefresh((n) => n + 1);
      if (hoverSong?.id === songId) setHoverSong(null);
      if (selectedSong?.id === songId) {
        setSelectedSong(null);
        liveSongIdRef.current = null;
        setLiveSong(null);
        localStorage.removeItem('lyrics-display-current');
        displayChannelRef.current?.postMessage({ type: 'clear' });
        publishLive(null);
      }
      return true;
    } catch (error) {
      console.error('Error deleting song:', error);
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

  // Default list: most recently opened first (stable sort keeps API order for
  // songs never opened); search results keep their relevance ranking. History
  // is read through a ref so clicking a song doesn't instantly resort the list
  // under the cursor — recency applies on the next load or search change. The
  // memo also keeps the array identity stable so the memoized SongList skips
  // re-rendering on hover/zoom/preview state changes.
  const openHistoryRef = useRef(openHistory);
  openHistoryRef.current = openHistory;
  const displaySongs = useMemo(() => {
    if (searchResults) return reorderByLanguageClient(searchResults.songs || [], selectedLanguages);
    const history = openHistoryRef.current;
    return [...songs].sort((a, b) => (history[b.id] || 0) - (history[a.id] || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, searchResults, selectedLanguages]);

  // Clear the live display (black screen, like Bible Clear). The preview
  // (selected/hover song) is left alone so the operator keeps their place.
  const handleClearLive = () => {
    if (isGuest()) return;
    liveSongIdRef.current = null;
    setLiveSong(null);
    localStorage.removeItem('lyrics-display-current');
    displayChannelRef.current?.postMessage({ type: 'clear', blank: true });
    publishLive(null);
  };

  // ===== Remote control handle =====
  const VIEW_ONLY: PanelResult = { ok: false, message: 'View-only account' };

  const sendSongLive = async (songId: string): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    const song = songs.find((s) => s.id === songId) ?? (await songsApi.getById(songId).catch(() => null));
    if (!song) return { ok: false, message: 'Song not found' };
    await handleSendToLive(song);
    return { ok: true, message: song.title };
  };

  const queueStep = async (dir: 1 | -1): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    // Always fetch the queue fresh: the remote may have changed it meanwhile.
    let items;
    try {
      items = await queueApi.getAll();
    } catch {
      return { ok: false, message: "Couldn't load the queue" };
    }
    if (!items.length) return { ok: false, message: 'The queue is empty' };
    const idx = items.findIndex((i) => i.song_id === liveSongIdRef.current);
    let pos: number;
    if (idx === -1) {
      if (dir === -1) return { ok: false, message: "The live song isn't in the queue" };
      pos = 0;
    } else {
      pos = idx + dir;
    }
    const target = items[pos];
    if (!target) return { ok: false, message: 'End of queue' };
    const song = target.song ?? (await songsApi.getById(target.song_id).catch(() => null));
    if (!song) return { ok: false, message: 'Song not found' };
    await handleSendToLive(song);
    return { ok: true, message: `${song.title} (${pos + 1}/${items.length})` };
  };

  const clearLive = async (): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    handleClearLive();
    return { ok: true, message: 'Cleared to black' };
  };

  const queueAdd = async (songId: string): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    try {
      await queueApi.add(songId);
      setQueueRefresh((n) => n + 1);
      return { ok: true, message: 'Added to queue' };
    } catch (err: any) {
      if (err?.response?.status === 409) return { ok: false, message: 'Already in the queue' };
      return { ok: false, message: "Couldn't add to the queue" };
    }
  };

  const queueRemove = async (queueItemId: number): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    try {
      await queueApi.remove(queueItemId);
      setQueueRefresh((n) => n + 1);
      return { ok: true, message: 'Removed from queue' };
    } catch {
      return { ok: false, message: "Couldn't remove it" };
    }
  };

  const zoom = async ({ delta, value }: { delta?: number; value?: number }): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    // Same 0.5–3.0 clamp as ZoomControls.
    const next = Math.round(Math.min(3.0, Math.max(0.5, value ?? (zoomLevel + (delta ?? 0)))) * 100) / 100;
    setZoomLevel(next);
    displayChannelRef.current?.postMessage({ type: 'zoom', zoomLevel: next });
    return { ok: true, message: `Zoom ${Math.round(next * 100)}%` };
  };

  // Consumed by the /display window only; the control window never listens.
  const scroll = async (dir: 1 | -1, amount: 'step' | 'page'): Promise<PanelResult> => {
    if (isGuest()) return VIEW_ONLY;
    if (!liveSongIdRef.current) return { ok: false, message: 'Nothing live to scroll' };
    displayChannelRef.current?.postMessage({ type: 'scroll', dir, amount });
    return { ok: true };
  };

  const refreshQueue = () => {
    setQueueRefresh((n) => n + 1);
  };

  // Used after a backend restart (poll reports live_updated_at 0).
  const republishLive = () => {
    if (liveSong) publishLive(liveSong);
  };

  // Latest-ref delegation: the handle is created once but always calls the
  // current render's closures (fresh songs, zoomLevel, liveSong).
  const apiRef = useRef<SongsPanelHandle>(null!);
  apiRef.current = { sendSongLive, queueStep, clearLive, queueAdd, queueRemove, zoom, scroll, refreshQueue, republishLive };
  useImperativeHandle(ref, () => ({
    sendSongLive: (id) => apiRef.current.sendSongLive(id),
    queueStep: (d) => apiRef.current.queueStep(d),
    clearLive: () => apiRef.current.clearLive(),
    queueAdd: (id) => apiRef.current.queueAdd(id),
    queueRemove: (id) => apiRef.current.queueRemove(id),
    zoom: (a) => apiRef.current.zoom(a),
    scroll: (d, a) => apiRef.current.scroll(d, a),
    refreshQueue: () => apiRef.current.refreshQueue(),
    republishLive: () => apiRef.current.republishLive(),
  }), []);

  // SongForm registers its dirty-checked close here so the modal X goes
  // through the same "discard unsaved changes?" confirm.
  const formCloseRef = useRef<(() => void) | null>(null);

  return (
    <>
      {selectedSong && isFullScreen && (
        <SongFullScreen
          song={selectedSong}
          onClose={() => setIsFullScreen(false)}
          onEdit={readOnly ? undefined : handleEdit}
          onDelete={readOnly ? undefined : handleDelete}
        />
      )}

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-3xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-ink">
                {editingSong ? 'Edit Song' : 'Add New Song'}
              </h2>
              <button
                onClick={() => (formCloseRef.current ? formCloseRef.current() : handleFormCancel())}
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
              onDelete={handleDelete}
              requestCloseRef={formCloseRef}
            />
          </div>
        </div>
      )}

      {showPreviewModal && previewSong && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => { setShowPreviewModal(false); setPreviewSong(null); }}
        >
          <div
            className="bg-surface-raised rounded-xl border border-edge shadow-2xl w-full max-w-5xl flex flex-col aspect-video overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
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
                {!readOnly && (
                <>
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
                </>
                )}
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
                  <FormattedLyrics text={previewSong.music_ministry_lyrics || previewSong.display_lyrics} />
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`${queueOpen ? 'w-full' : 'max-w-7xl mx-auto'} px-4 sm:px-6 py-4 sm:py-6 flex flex-col md:flex-row gap-5 md:items-start`}>
        {/* Queue pushes content right instead of overlaying it (stacks above on phones) */}
        {queueOpen && (
          <div className="w-full md:w-[300px] shrink-0 md:self-stretch md:sticky md:top-20 max-h-[60vh] md:max-h-[calc(100vh-120px)]">
            <QueuePanel
              isOpen={queueOpen}
              onToggle={() => setQueueOpen(false)}
              onSongSelect={(song) => handleSelectSong(song)}
              onSendToLive={readOnly ? undefined : handleSendToLive}
              readOnly={readOnly}
              refreshToken={queueRefresh}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 w-full space-y-5">
        {songPing && (
          <div className="fade-swap flex items-center gap-3 bg-accent/10 border border-accent/40 rounded-lg px-4 py-2.5" role="status" aria-live="polite">
            <BellIcon className="w-4 h-4 text-accent-hover shrink-0" />
            <p className="flex-1 min-w-0 text-sm text-ink-dim truncate">
              {songPing.from_role} ({songPing.from_user}) is pointing at{' '}
              <span className="font-semibold text-ink">{songPing.title}</span>
            </p>
            <button
              onClick={handlePingPreview}
              className="shrink-0 h-8 px-3.5 rounded-md border border-edge text-ink-dim hover:text-ink hover:border-accent text-sm font-medium cursor-pointer transition-colors duration-150"
            >
              Preview
            </button>
            {!readOnly && (
              <button
                onClick={handlePingAddToQueue}
                className="shrink-0 h-8 px-3.5 rounded-md border border-accent/50 text-accent-hover hover:bg-accent/15 text-sm font-medium cursor-pointer transition-colors duration-150"
              >
                Add to queue
              </button>
            )}
            <button
              onClick={() => setSongPing(null)}
              aria-label="Dismiss"
              title="Dismiss"
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex items-start gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <SearchBar onSearch={handleSearch} />
          </div>
          <button
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            title={queueOpen ? 'Hide queue' : 'Show song queue'}
            className={`shrink-0 h-[46px] px-3 sm:px-4 flex items-center gap-2 rounded-lg border cursor-pointer text-sm font-medium ${
              queueOpen
                ? 'bg-accent/15 border-accent/50 text-accent-hover'
                : 'bg-surface-raised border-edge text-ink-dim hover:text-ink hover:border-accent'
            }`}
          >
            <MusicIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Queue</span>
            {queueCount > 0 && (
              <span className={`min-w-[20px] h-5 px-1 flex items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                queueOpen ? 'bg-accent/25 text-accent-hover' : 'bg-surface-sunken border border-edge text-ink-dim'
              }`}>
                {queueCount}
              </span>
            )}
          </button>
          {!readOnly && (
            <button
              onClick={handleCreateNew}
              aria-label="Add new song"
              title="Add new song"
              className="shrink-0 h-[46px] w-[46px] flex items-center justify-center rounded-lg bg-accent-deep hover:bg-accent text-on-accent cursor-pointer transition-colors duration-150"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {searchResults && (
          <div className="bg-surface-raised rounded-lg border border-edge px-3 py-2">
            <p className="text-sm text-ink-dim">
              Found <span className="text-ink font-medium">{searchResults.total_found}</span> results in {searchResults.search_time_ms}ms
            </p>
          </div>
        )}

        {actionError && (
          <div className="fade-swap bg-danger/10 border border-danger/40 rounded-lg px-4 py-2.5" role="alert" aria-live="polite">
            <p className="text-sm text-danger">{actionError}</p>
          </div>
        )}

        {loadError && !loading && (
          <div className="flex items-center gap-3 bg-danger/10 border border-danger/40 rounded-lg px-4 py-3" role="alert">
            <p className="text-sm text-danger flex-1">{loadError}</p>
            <button
              onClick={loadSongs}
              className="h-8 px-3.5 rounded-md border border-danger/50 text-danger hover:bg-danger/15 text-sm font-medium cursor-pointer transition-colors duration-150"
            >
              Retry
            </button>
          </div>
        )}

        {/* Phones: one column (results, then live/preview). md+: resizable split. */}
        <div
          ref={splitContainerRef}
          className="flex flex-col md:flex-row w-full gap-4 md:min-h-[60vh]"
          style={{ '--split-left': `${leftWidth * 100}%`, '--split-right': `${(1 - leftWidth) * 100}%` } as React.CSSProperties}
        >
          {/* Left - Search results */}
          <div className="space-y-3 min-w-0 md:basis-[var(--split-left)] md:min-w-[35%]">
            <SongList
              songs={displaySongs}
              onSelectSong={handleSelectSong}
              onEdit={readOnly ? undefined : handleEdit}
              onSendToLive={readOnly ? undefined : handleSendToLive}
              onAddToQueue={readOnly ? undefined : handleAddToQueue}
              selectedSongId={selectedSong?.id}
              loading={loading}
            />
          </div>

          {/* Splitter */}
          <div
            role="separator"
            aria-orientation="vertical"
            className="hidden md:block w-1.5 bg-edge hover:bg-accent/60 rounded-full cursor-col-resize select-none transition-colors duration-150"
            style={{ minHeight: '100%', cursor: 'col-resize' }}
            onMouseDown={() => {
              setIsDragging(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          ></div>

          {/* Right - Live, Queue & Preview */}
          <div className="space-y-4 min-w-0 md:basis-[var(--split-right)] md:min-w-[25%]">
            {/* ProPresenter Integration (not shown to worship) */}
            {role !== 'worship' && role !== 'guest' && (
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
                  onClick={handleToggleSync}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                    ppSyncEnabled
                      ? 'bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25'
                      : 'bg-surface-hover text-ink-mute border border-edge-strong hover:text-ink-dim'
                  }`}
                  disabled={!ppStatus?.connected}
                  title={ppSyncEnabled ? 'Click to disable auto-sync' : 'Click to enable auto-sync (re-checks the playlist)'}
                >
                  {ppSyncEnabled ? 'Sync on' : 'Sync off'}
                </button>
              </div>
              {ppStatus?.connected && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => runReconcile(false)}
                    disabled={reconciling}
                    className="h-8 px-3 rounded-md border border-edge text-ink-dim hover:text-ink hover:border-accent cursor-pointer text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Check the ProPresenter playlist and add any queued songs that are missing"
                  >
                    {reconciling ? 'Checking…' : 'Check playlist'}
                  </button>
                  <span className="text-xs text-ink-mute flex-1 truncate" title={reconcileMsg}>
                    {reconcileMsg || 'Queue syncs to the Live Queue playlist'}
                  </span>
                </div>
              )}
            </div>
            )}

            {/* Live monitor + song preview (drag divider to resize) */}
            <div className="bg-surface-raised rounded-xl border border-edge p-4 space-y-2">
              {/* LIVE — mirrors the display window; zoom here controls it */}
              {liveCollapsed ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleLiveCollapsed}
                    title="Expand live monitor"
                    className="flex-1 min-w-0 h-9 flex items-center justify-between px-3 rounded-lg bg-surface-sunken border border-edge cursor-pointer text-xs"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${liveSong ? 'bg-live animate-pulse' : 'bg-edge-strong'}`} />
                      <span className="font-bold tracking-widest text-live">LIVE</span>
                      <span className="text-ink-mute truncate max-w-[180px]">{liveSong ? liveSong.title : 'Nothing live'}</span>
                    </span>
                    <ChevronDownIcon className="w-3.5 h-3.5 text-ink-mute" />
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleClearLive}
                      disabled={!liveSong}
                      title="Clear the live display"
                      aria-label="Clear live display"
                      className="h-9 px-3 rounded-lg border border-edge text-ink-mute hover:text-danger hover:border-danger/50 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ) : (
              <div style={{ width: `${liveFrac * 100}%` }} className="mx-auto relative">
                {!readOnly && (
                  <button
                    type="button"
                    onClick={handleClearLive}
                    disabled={!liveSong}
                    title="Clear the live display"
                    aria-label="Clear live display"
                    className="absolute bottom-2 right-11 z-10 h-7 px-2.5 rounded-md bg-black/60 border border-edge text-ink-mute hover:text-danger hover:border-danger/50 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                )}
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
                  scrollScope="live"
                  overlay={
                    <ZoomControls
                      value={zoomLevel}
                      onChange={(z) => {
                        setZoomLevel(z);
                        if (!readOnly) displayChannelRef.current?.postMessage({ type: 'zoom', zoomLevel: z });
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
                    ref={inlineTextareaRef}
                    value={inlineDraft}
                    onChange={(e) => setInlineDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                        e.preventDefault();
                        setInlineDraft(toggleBoldInTextarea(e.currentTarget));
                      }
                    }}
                    autoFocus
                    style={{ fontFamily, textAlign: align }}
                    className="flex-1 w-full bg-black text-white text-sm p-4 resize-none focus:outline-none"
                  />
                  <div className="flex items-center gap-2 p-2 border-t border-edge bg-surface-sunken">
                    <button
                      onClick={() => {
                        const el = inlineTextareaRef.current;
                        if (el) { setInlineDraft(toggleBoldInTextarea(el)); el.focus(); }
                      }}
                      title="Bold the selection (Ctrl+B)"
                      className="h-8 w-8 rounded-md border border-edge text-ink-dim hover:text-ink hover:border-edge-strong cursor-pointer text-sm font-black"
                    >
                      B
                    </button>
                    <span className="w-px h-4 bg-edge" aria-hidden />
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => applyAlign(a)}
                        aria-pressed={align === a}
                        title={`Align ${a} on the display (${a[0].toUpperCase()})`}
                        className={`h-8 w-8 rounded-md border flex flex-col justify-center gap-[3px] px-2 cursor-pointer transition-colors ${
                          a === 'left' ? 'items-start' : a === 'right' ? 'items-end' : 'items-center'
                        } ${
                          align === a
                            ? 'border-accent/50 bg-accent/15 text-accent-hover'
                            : 'border-edge text-ink-dim hover:text-ink hover:border-edge-strong'
                        }`}
                      >
                        <span className="block h-[1.5px] w-full bg-current rounded" />
                        <span className="block h-[1.5px] w-3/5 bg-current rounded" />
                        <span className="block h-[1.5px] w-4/5 bg-current rounded" />
                      </button>
                    ))}
                    <select
                      value={fontFamily}
                      onChange={(e) => applyFontFamily(e.target.value)}
                      aria-label="Display font"
                      title="Display font"
                      className="h-8 rounded-md border border-edge bg-surface-input text-ink text-xs px-2 cursor-pointer hover:border-edge-strong focus:border-accent focus:outline-none"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    {inlineError && (
                      <span role="alert" className="text-xs text-danger">
                        Couldn&apos;t save lyrics — your edit is still here. Try again.
                      </span>
                    )}
                    <button
                      onClick={() => { setInlineEdit(false); setInlineEditSong(null); setInlineError(false); }}
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
                scrollScope="preview"
                overlay={
                  <>
                    {!readOnly && (
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
                    </>
                    )}
                    <CopyLyricsButton song={hoverSong || selectedSong} />
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

export default forwardRef<SongsPanelHandle, SongsPanelProps>(SongsPanel);

// Copies the song's display lyrics as plain text — bold markers stripped,
// line breaks and verse gaps kept — so it pastes cleanly anywhere.
function CopyLyricsButton({ song }: { song: Song | null }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleCopy = async () => {
    const text = stripBold(song?.display_lyrics).trim();
    if (!text) return;
    try {
      await copyText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy lyrics:', err);
      alert("Couldn't copy the lyrics. Try again.");
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`w-7 h-7 flex items-center justify-center rounded cursor-pointer ${copied ? 'text-ok' : 'text-ink-dim hover:text-ink'}`}
      aria-label={copied ? 'Lyrics copied' : 'Copy lyrics as plain text'}
      title={copied ? 'Copied' : 'Copy lyrics (plain text)'}
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
    </button>
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
function SongReplica({ song, zoom, emptyText, badge, badgeClass, overlay, scrollScope }: {
  song: Song | null;
  zoom: number;
  emptyText: string;
  badge: string;
  badgeClass: string;
  overlay: React.ReactNode;
  scrollScope: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  // Same per-song scroll memory as the display window, so the monitor doesn't
  // inherit the previous song's offset when the song changes.
  const scrollMemory = useScrollMemory(song ? `monitor-scroll:${scrollScope}:${song.id}` : undefined);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    setW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  const spacing = useLyricSpacing();
  return (
    <div ref={boxRef} className="bg-black rounded-lg border border-edge overflow-hidden aspect-video w-full relative">
      <span className={`absolute top-2 left-2 z-10 text-[10px] font-bold tracking-widest bg-black/60 px-1.5 py-0.5 rounded ${badgeClass}`}>
        {badge}
      </span>
      {song && (
        <div className="absolute bottom-2 md:bottom-auto md:top-2 right-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-1 rounded-md border border-edge">
          {overlay}
        </div>
      )}
      {song ? (
        <div
          className="absolute top-0 left-0 overflow-hidden"
          style={{ width: 1920, height: 1080, transform: `scale(${w / 1920})`, transformOrigin: 'top left' }}
        >
          <div
            ref={scrollMemory.paneRef(0)}
            onScroll={scrollMemory.onPaneScroll(0)}
            className="h-full w-full overflow-y-auto p-12"
          >
            <div className="min-h-full w-full flex items-center justify-center">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }} className="w-full">
                <pre
                  className={`whitespace-pre-wrap text-center w-full text-5xl text-white ${['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'].includes((song.language || '').toLowerCase()) ? 'script-indic' : ''}`}
                >
                  <LyricBlocks
                    text={song.music_ministry_lyrics || song.display_lyrics}
                    lineHeight={['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'].includes((song.language || '').toLowerCase()) ? spacing.line + INDIC_EXTRA : spacing.line}
                    paragraphSpacing={spacing.paragraph}
                  />
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