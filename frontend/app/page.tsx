'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus, queueApi, QueueItem } from '@/lib/api';
import SearchBar, { SearchBarRef } from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';
import SettingsDialog from '@/components/SettingsDialog';
import QueuePanel from '@/components/QueuePanel';

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
  const [ppNotification, setPpNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  const [leftWidth, setLeftWidth] = useState(0.6);
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const leftWidthRef = useRef(0.6);
  const rafIdRef = useRef<number | null>(null);
  const [isEditingInline, setIsEditingInline] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedArtist, setEditedArtist] = useState('');
  const [editedLanguage, setEditedLanguage] = useState('');
  const [editedLyrics, setEditedLyrics] = useState('');
  const [inlineSaveLoading, setInlineSaveLoading] = useState(false);
  const searchBarRef = useRef<SearchBarRef>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [queuedSongIds, setQueuedSongIds] = useState<Set<string>>(new Set());

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

  // Ctrl+F keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        searchBarRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check ProPresenter connection status
  const checkProPresenterStatus = async () => {
    try {
      const status = await propresenterApi.getStatus();
      console.log('ProPresenter status response:', status);
      setPpStatus(status);
      // If status shows enabled but we got a response, it's at least enabled
      if (!status.enabled && status.message) {
        // Check if the message indicates it's actually enabled but just not connected
        if (status.message.includes('not configured') || status.message.includes('not enabled')) {
          setPpStatus({ enabled: false, connected: false, message: status.message });
        } else {
          // Likely enabled but connection issue
          setPpStatus({ enabled: true, connected: false, message: status.message });
        }
      }
    } catch (err: any) {
      console.error('Failed to check ProPresenter status:', err);
      // If it's a 503, it means not enabled
      if (err?.response?.status === 503) {
        setPpStatus({ enabled: false, connected: false, message: 'ProPresenter integration not enabled on backend' });
      } else if (err?.response?.status === 404) {
        // Backend endpoint doesn't exist
        setPpStatus({ enabled: false, connected: false, message: 'Backend API endpoint not found' });
      } else {
        // Network error or other - assume enabled but not connected
        setPpStatus({ enabled: true, connected: false, message: 'Failed to connect - check backend and Tailscale' });
      }
    }
  };

  // Fetch queue and update queued song IDs
  const fetchQueue = useCallback(async () => {
    try {
      const items = await queueApi.getAll();
      const songIds = new Set(items.map((item) => item.song_id));
      setQueuedSongIds(songIds);
    } catch (err) {
      console.error('Failed to fetch queue:', err);
    }
  }, []);

  // Add song to queue
  const handleAddToQueue = async (song: Song) => {
    try {
      await queueApi.add(song.id);
      await fetchQueue();
    } catch (err: any) {
      console.error('Failed to add to queue:', err);
      if (err?.response?.status === 409) {
        alert('This song is already in the queue');
      } else {
        alert('Failed to add song to queue');
      }
    }
  };

  // Handle queue changes
  const handleQueueChange = () => {
    fetchQueue();
  };

  // Load all songs and queue on mount
  useEffect(() => {
    loadSongs();
    checkProPresenterStatus();
    fetchQueue();
  }, [fetchQueue]);

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
        lyrics: song.music_ministry_lyrics,
        content: song.display_lyrics,
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
        
        const result = await propresenterApi.sendToQueue(song.id, song.title, ppPlaylistName, ppThemeName || undefined, song.display_lyrics || song.music_ministry_lyrics);
        console.log('✅ ProPresenter sync successful:', result);
        // Show success notification
        setPpNotification({ message: 'Pushed to ProPresenter', type: 'success' });
        setTimeout(() => setPpNotification(null), 3000);
      } catch (err: any) {
        console.error('❌ Failed to sync with ProPresenter:', err);
        // Show error notification
        const errorMessage = err?.response?.data?.message || err?.message || 'Unknown error';
        setPpNotification({ message: `Sync failed: ${errorMessage}`, type: 'error' });
        setTimeout(() => setPpNotification(null), 5000);
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
      // Optimistic update: Remove from state immediately
      setSongs(prevSongs => prevSongs.filter(song => song.id !== songId));
      
      // Update search results if the song is in there
      if (searchResults) {
        setSearchResults(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            songs: prev.songs.filter(song => song.id !== songId),
            total_found: prev.total_found - 1
          };
        });
      }
      
      // Clear selection if deleted song was selected
      if (selectedSong?.id === songId) {
        setSelectedSong(null);
        localStorage.removeItem('lyrics-display-current');
        displayChannelRef.current?.postMessage({ type: 'clear' });
      }
      
      // Clear live song if deleted song was live
      if (liveSong?.id === songId) {
        setLiveSong(null);
      }
      
      // Actually delete from server
      await songsApi.delete(songId);
      
      return true;
    } catch (error) {
      console.error('Error deleting song:', error);
      // Revert optimistic update on error
      await loadSongs();
      alert('Failed to delete song');
      return false;
    }
  };

  const handleFormSubmit = async (updatedSong?: Song) => {
    setShowForm(false);
    const editedSongId = editingSong?.id;
    setEditingSong(null);
    
    if (updatedSong) {
      // Optimistic update: Use the song returned from the API
      const songId = updatedSong.id;
      
      // Update the song in the local state
      setSongs(prevSongs => {
        // If it's a new song, add it; otherwise update existing
        const exists = prevSongs.some(s => s.id === songId);
        if (exists) {
          return prevSongs.map(song => song.id === songId ? updatedSong : song);
        } else {
          return [updatedSong, ...prevSongs];
        }
      });
      
      // Update search results if the song is in there
      if (searchResults) {
        setSearchResults(prev => {
          if (!prev) return prev;
          const exists = prev.songs.some(s => s.id === songId);
          return {
            ...prev,
            songs: exists 
              ? prev.songs.map(song => song.id === songId ? updatedSong : song)
              : [updatedSong, ...prev.songs],
            total_found: exists ? prev.total_found : prev.total_found + 1
          };
        });
      }
      
      // If the edited song was the live song, update it
      if (liveSong?.id === songId) {
        handleSendToLive(updatedSong);
      }
      
      // If the edited song was selected, update it
      if (selectedSong?.id === songId) {
        setSelectedSong(updatedSong);
      }
    } else {
      // Fallback: If no song returned, reload all songs
      await loadSongs();
    }
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingSong(null);
  };

  const handleStartInlineEdit = (song: Song) => {
    setEditedTitle(song.title);
    setEditedArtist(song.artist || '');
    setEditedLanguage(song.language);
    setEditedLyrics(song.music_ministry_lyrics);
    setIsEditingInline(true);
  };

  const handleCancelInlineEdit = () => {
    setIsEditingInline(false);
    setEditedTitle('');
    setEditedArtist('');
    setEditedLanguage('');
    setEditedLyrics('');
  };

  const handleSaveInlineEdit = async () => {
    if (!selectedSong) return;

    try {
      setInlineSaveLoading(true);
      const updates = {
        title: editedTitle.trim(),
        artist: editedArtist.trim() || '',
        language: editedLanguage,
        music_ministry_lyrics: editedLyrics.trim(),
        display_lyrics: editedLyrics.trim(), // Use same for both
        library: selectedSong.library,
      };

      const updatedSong = await songsApi.update(selectedSong.id, updates);

      // Update local state
      setSongs(prevSongs =>
        prevSongs.map(song => song.id === updatedSong.id ? updatedSong : song)
      );

      if (searchResults) {
        setSearchResults(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            songs: prev.songs.map(song => song.id === updatedSong.id ? updatedSong : song)
          };
        });
      }

      setSelectedSong(updatedSong);

      // If this was the live song, update it
      if (liveSong?.id === updatedSong.id) {
        handleSendToLive(updatedSong);
      }

      setIsEditingInline(false);
    } catch (error) {
      console.error('Error saving song:', error);
      alert('Failed to save changes');
    } finally {
      setInlineSaveLoading(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;

    // Allow default browser undo/redo
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      return; // Let browser handle undo/redo
    }

    // Handle Tab key
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      if (e.shiftKey) {
        // Shift+Tab: Unindent
        const lines = value.substring(0, start).split('\n');
        const currentLineStart = start - lines[lines.length - 1].length;
        const currentLine = value.substring(currentLineStart, value.indexOf('\n', start) === -1 ? value.length : value.indexOf('\n', start));

        if (currentLine.startsWith('  ')) {
          const newValue = value.substring(0, currentLineStart) + currentLine.substring(2) + value.substring(currentLineStart + currentLine.length);
          setEditedLyrics(newValue);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start - 2;
          }, 0);
        }
      } else {
        // Tab: Insert 2 spaces
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        setEditedLyrics(newValue);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      }
    }

    // Handle Ctrl+] for indent
    if (e.ctrlKey && e.key === ']') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      if (start === end) {
        // No selection, indent current line
        const lines = value.substring(0, start).split('\n');
        const currentLineStart = start - lines[lines.length - 1].length;
        const beforeLine = value.substring(0, currentLineStart);
        const afterCursor = value.substring(start);

        const newValue = beforeLine + '  ' + value.substring(currentLineStart, start) + afterCursor;
        setEditedLyrics(newValue);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      } else {
        // Selection exists, indent all selected lines
        const beforeSelection = value.substring(0, start);
        const selection = value.substring(start, end);
        const afterSelection = value.substring(end);

        const lines = selection.split('\n');
        const indentedLines = lines.map(line => '  ' + line);
        const newSelection = indentedLines.join('\n');

        const newValue = beforeSelection + newSelection + afterSelection;
        setEditedLyrics(newValue);
        setTimeout(() => {
          textarea.selectionStart = start;
          textarea.selectionEnd = start + newSelection.length;
        }, 0);
      }
    }

    // Handle Ctrl+[ for unindent
    if (e.ctrlKey && e.key === '[') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      if (start === end) {
        // No selection, unindent current line
        const lines = value.substring(0, start).split('\n');
        const currentLineStart = start - lines[lines.length - 1].length;
        const lineEnd = value.indexOf('\n', start);
        const currentLine = value.substring(currentLineStart, lineEnd === -1 ? value.length : lineEnd);

        if (currentLine.startsWith('  ')) {
          const newLine = currentLine.substring(2);
          const newValue = value.substring(0, currentLineStart) + newLine + value.substring(currentLineStart + currentLine.length);
          setEditedLyrics(newValue);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = Math.max(currentLineStart, start - 2);
          }, 0);
        }
      } else {
        // Selection exists, unindent all selected lines
        const beforeSelection = value.substring(0, start);
        const selection = value.substring(start, end);
        const afterSelection = value.substring(end);

        const lines = selection.split('\n');
        const unindentedLines = lines.map(line => line.startsWith('  ') ? line.substring(2) : line);
        const newSelection = unindentedLines.join('\n');

        const newValue = beforeSelection + newSelection + afterSelection;
        setEditedLyrics(newValue);
        setTimeout(() => {
          textarea.selectionStart = start;
          textarea.selectionEnd = start + newSelection.length;
        }, 0);
      }
    }
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
                  {previewSong.music_ministry_lyrics}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-[#111214] text-gray-100">
        {/* Top Bar */}
        <div className="bg-[#1a1b1f] border-b border-[#2a2c31] px-6 py-3" style={{ marginLeft: isQueueOpen ? '300px' : '0', transition: 'margin-left 0.3s ease' }}>
          <div className="max-w-full mx-auto flex items-center justify-between gap-4">
            {/* Left: Queue Toggle + Live Status */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsQueueOpen(!isQueueOpen)}
                className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2c31] transition-colors"
                title="Toggle Queue"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => {
                  if (liveSong) {
                    setSelectedSong(liveSong);
                    setPreviewSong(null);
                    setIsEditingInline(false);
                  }
                }}
                className={`flex items-center gap-2 bg-[#141518] px-3 py-2 rounded-lg border border-[#2a2c31] transition-colors ${
                  liveSong ? 'hover:border-[#3a3c42] cursor-pointer' : 'cursor-default'
                }`}
                disabled={!liveSong}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-sm font-medium">
                  {liveSong ? liveSong.title : 'No song live'}
                </span>
              </button>
              <button
                onClick={() => window.open('/display', '_blank', 'noopener,noreferrer')}
                className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                Launch Display
              </button>
            </div>

            {/* Center: Display Controls */}
            <div className="flex items-center gap-2">
              {/* Text Alignment Controls */}
              <div className="flex items-center gap-1 bg-[#141518] px-2 py-1 rounded-md border border-[#2a2c31]">
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
                    textAlign === 'left' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-[#2a2c31]'
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
                    textAlign === 'center' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-[#2a2c31]'
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
                    textAlign === 'right' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-[#2a2c31]'
                  }`}
                  title="Align Right"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
                  </svg>
                </button>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1.5 bg-[#141518] px-2 py-1 rounded-md border border-[#2a2c31]">
                <button
                  onClick={() => {
                    const newZoom = Math.max(0.3, zoomLevel - 0.1);
                    setZoomLevel(newZoom);
                    displayChannelRef.current?.postMessage({
                      type: 'zoom',
                      zoomLevel: newZoom,
                    });
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-[#2a2c31] transition-colors text-base font-bold"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <span className="text-xs text-gray-400 min-w-[2.5rem] text-center">
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
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-[#2a2c31] transition-colors text-base font-bold"
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>

              {/* Split Controls */}
              <div className="flex items-center gap-1.5 bg-[#141518] px-2 py-1 rounded-md border border-[#2a2c31]">
                <button
                  onClick={() => {
                    displayChannelRef.current?.postMessage({
                      type: 'addSplit',
                    });
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-[#2a2c31] transition-colors"
                  aria-label="Add split"
                  title="Add split (])"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    displayChannelRef.current?.postMessage({
                      type: 'removeSplit',
                    });
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-[#2a2c31] transition-colors"
                  aria-label="Remove split"
                  title="Remove split ([)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Right: Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(true)}
                className="h-9 w-9 flex items-center justify-center rounded-md bg-[#141518] border border-[#2a2c31] hover:border-[#3a3c42] transition-colors"
                title="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={handleCreateNew}
                className="h-9 px-4 flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <span className="mr-1.5">+</span> New Song
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-full mx-auto px-6 py-5" style={{ marginLeft: isQueueOpen ? '300px' : '0', transition: 'margin-left 0.3s ease' }}>
          {/* 50/50 Split Layout */}
          <div className="flex gap-4" style={{ height: 'calc(100vh - 140px)' }}>
            {/* Left Half - Search Bar, Filters, and Song List */}
            <div className="w-1/2 flex flex-col gap-4">
              {/* Search Bar */}
              <div className="flex-shrink-0">
                <SearchBar ref={searchBarRef} onSearch={handleSearch} />
              </div>

              {/* Search Results Info */}
              {isSearching && searchResults && (
                <div className="bg-[#1a1b1f] rounded-lg border border-[#2a2c31] p-2 flex-shrink-0">
                  <p className="text-xs text-gray-400">
                    Found {searchResults.total_found} results in {searchResults.search_time_ms}ms
                  </p>
                </div>
              )}

              {/* Song List */}
              <div className="flex-1 overflow-hidden">
                <SongList
                  songs={displaySongs}
                  onSelectSong={(song) => {
                    setSelectedSong(song);
                    setPreviewSong(null);
                  }}
                  onSendToLive={handleSendToLive}
                  onAddToQueue={handleAddToQueue}
                  queuedSongIds={queuedSongIds}
                  selectedSongId={selectedSong?.id}
                  loading={loading}
                />
              </div>
            </div>

            {/* Right Half - File Preview */}
            <div className={`bg-[#1a1b1f] rounded-xl border border-[#2a2c31] flex flex-col overflow-hidden transition-all duration-300 ${isQueueOpen ? 'flex-1' : 'w-1/2'}`}>
              {selectedSong ? (
                <>
                  {/* Header with song info and actions */}
                  <div className="flex-shrink-0 border-b border-[#2a2c31] p-4">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1">
                        {isEditingInline ? (
                          <>
                            <input
                              type="text"
                              value={editedTitle}
                              onChange={(e) => setEditedTitle(e.target.value)}
                              className="w-full text-xl font-bold text-white mb-2 bg-[#141518] border border-[#2a2c31] rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                              placeholder="Song title"
                            />
                            <input
                              type="text"
                              value={editedArtist}
                              onChange={(e) => setEditedArtist(e.target.value)}
                              className="w-full text-gray-400 text-sm mb-2 bg-[#141518] border border-[#2a2c31] rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                              placeholder="Artist (optional)"
                            />
                            <select
                              value={editedLanguage}
                              onChange={(e) => setEditedLanguage(e.target.value)}
                              className="bg-blue-600 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option value="english">English</option>
                              <option value="malayalam">Malayalam</option>
                              <option value="hindi">Hindi</option>
                              <option value="tamil">Tamil</option>
                              <option value="telugu">Telugu</option>
                              <option value="kannada">Kannada</option>
                            </select>
                          </>
                        ) : (
                          <>
                            <h2 className="text-xl font-bold text-white mb-1">{selectedSong.title}</h2>
                            {selectedSong.artist && (
                              <p className="text-gray-400 text-sm mb-2">{selectedSong.artist}</p>
                            )}
                            <span className="inline-block bg-blue-600 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">
                              {selectedSong.language}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {isEditingInline ? (
                          <>
                            <button
                              onClick={handleSaveInlineEdit}
                              disabled={inlineSaveLoading}
                              className="px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white text-sm font-medium transition-colors"
                            >
                              {inlineSaveLoading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={handleCancelInlineEdit}
                              disabled={inlineSaveLoading}
                              className="px-3 py-2 rounded-md bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 text-white text-sm font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartInlineEdit(selectedSong)}
                              className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleSendToLive(selectedSong)}
                              className="px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                            >
                              Send to Live
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lyrics Content - Scrollable */}
                  <div className="flex-1 overflow-y-auto bg-[#141518] p-6">
                    {isEditingInline ? (
                      <textarea
                        value={editedLyrics}
                        onChange={(e) => setEditedLyrics(e.target.value)}
                        onKeyDown={handleTextareaKeyDown}
                        className="w-full h-full min-h-[400px] bg-[#1a1b1f] border border-[#2a2c31] rounded-lg p-4 text-base leading-relaxed text-gray-200 font-sans focus:outline-none focus:border-blue-500 resize-none"
                        placeholder="Enter lyrics..."
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed text-gray-200">
                        {selectedSong.music_ministry_lyrics}
                      </pre>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#141518] flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                    <p className="text-gray-500 text-base">No song selected</p>
                    <p className="text-gray-600 text-sm mt-2">Select a song from the list to preview</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ProPresenter Notification - Bottom Right */}
      {ppNotification && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border ${
          ppNotification.type === 'success' 
            ? 'bg-green-900/90 border-green-700 text-green-100' 
            : 'bg-red-900/90 border-red-700 text-red-100'
        } transition-all duration-300`}>
          <div className="flex items-center gap-2">
            {ppNotification.type === 'success' ? (
              <span className="text-green-400">✓</span>
            ) : (
              <span className="text-red-400">✕</span>
            )}
            <span className="text-sm font-medium">{ppNotification.message}</span>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={() => {
          // Reload ProPresenter status after settings change
          checkProPresenterStatus();
        }}
      />

      {/* Queue Panel */}
      <QueuePanel
        isOpen={isQueueOpen}
        onToggle={() => setIsQueueOpen(!isQueueOpen)}
        onSongSelect={handleSendToLive}
        onQueueChange={handleQueueChange}
      />
    </>
  );
}
