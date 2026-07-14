import axios from 'axios';

// Next.js replaces NEXT_PUBLIC_* vars at build time
// Fallback to default if not set
const BUILT_API_URL =
  (typeof window !== 'undefined'
    ? (window as any).__NEXT_PUBLIC_API_URL__
    : undefined) ||
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8080/api';

// The build-time URL defaults to localhost, which breaks any second device on
// the LAN (a tablet's "localhost" is itself). If the page is being served from
// a non-localhost host but the API URL points at localhost, assume the backend
// lives on the same host as the frontend and follow the page's hostname.
function resolveApiUrl(): string {
  if (typeof window === 'undefined') return BUILT_API_URL;
  try {
    const url = new URL(BUILT_API_URL);
    const pageHost = window.location.hostname;
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const pageIsLocal = pageHost === 'localhost' || pageHost === '127.0.0.1';
    if (isLocal && !pageIsLocal) {
      url.hostname = pageHost;
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Malformed URL: fall through to the built value.
  }
  return BUILT_API_URL;
}

const API_URL = resolveApiUrl();

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Log API URL for debugging (only in development)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  console.log('API URL:', API_URL);
}

// Attach the session token to every request.
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('sat-token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Add error interceptor for better debugging
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
    });
    if (
      typeof window !== 'undefined' &&
      error.response?.status === 401 &&
      !window.location.pathname.startsWith('/login')
    ) {
      localStorage.removeItem('sat-token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface Song {
  id: string;
  title: string;
  file_name?: string;
  library: string;
  language: string;
  pro_uuid?: string;
  display_lyrics: string;
  music_ministry_lyrics: string;
  artist?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSongRequest {
  title: string;
  file_name?: string;
  library: string;
  language: string;
  pro_uuid?: string;
  display_lyrics: string;
  music_ministry_lyrics: string;
  artist?: string;
}

export interface UpdateSongRequest {
  title?: string;
  library?: string;
  language?: string;
  display_lyrics?: string;
  music_ministry_lyrics?: string;
  artist?: string;
}

export interface SearchResult {
  songs: Song[];
  total_found: number;
  search_time_ms: number;
}

// Song CRUD operations
export const songsApi = {
  // Create a new song
  create: async (data: CreateSongRequest): Promise<Song> => {
    const response = await api.post<Song>('/songs', data);
    return response.data;
  },

  // Get all songs
  getAll: async (): Promise<Song[]> => {
    const response = await api.get<Song[]>('/songs');
    return response.data || [];
  },

  // Get a single song by ID
  getById: async (id: string): Promise<Song> => {
    const response = await api.get<Song>(`/songs/${id}`);
    return response.data;
  },

  // Update a song
  update: async (id: string, data: UpdateSongRequest): Promise<Song> => {
    const response = await api.put<Song>(`/songs/${id}`, data);
    return response.data;
  },

  // Delete a song
  delete: async (id: string): Promise<void> => {
    await api.delete(`/songs/${id}`);
  },

  // Search songs
  search: async (query: string, languages?: string[]): Promise<SearchResult> => {
    const params = new URLSearchParams({ q: query });
    if (languages && languages.length > 0) {
      params.append('languages', languages.join(','));
    }
    const response = await api.get<SearchResult>(`/search?${params.toString()}`);
    return response.data;
  },
};

// Edit audit log (admin only)
export interface EditLog {
  id: number;
  username: string;
  role: string;
  action: 'create' | 'update' | 'delete';
  song_id?: string;
  song_title: string;
  changes?: Record<string, { old: string; new: string }>;
  created_at: string;
}

// Admin operations
export const adminApi = {
  // Get recent edit logs
  getEditLogs: async (limit = 200): Promise<EditLog[]> => {
    const response = await api.get<EditLog[]>(`/admin/edit-logs?limit=${limit}`);
    return response.data;
  },

  // Trigger reindex
  reindex: async (): Promise<{ message: string; count: number }> => {
    const response = await api.post('/admin/reindex');
    return response.data;
  },

  // Get backups
  getBackups: async (): Promise<any[]> => {
    const response = await api.get('/admin/backups');
    return response.data;
  },

  // Create manual backup
  createBackup: async (): Promise<{ message: string }> => {
    const response = await api.post('/admin/backups');
    return response.data;
  },
};

// ProPresenter integration
export interface ProPresenterStatus {
  enabled: boolean;
  connected: boolean;
  message: string;
}

export interface ProPresenterLibraryItem {
  id: {
    uuid: string;
    name: string;
    type: string;
  };
  type: string;
}

export interface ProPresenterPlaylist {
  id: {
    uuid: string;
    name: string;
    type: string;
  };
}

export interface ProPresenterQueueResult {
  success: boolean;
  message: string;
  song_title: string;
  playlist: string;
  pp_item_uuid: string;
}

export const propresenterApi = {
  // Get ProPresenter connection status
  getStatus: async (): Promise<ProPresenterStatus> => {
    const response = await api.get<ProPresenterStatus>('/propresenter/status');
    return response.data;
  },

  // Get ProPresenter library items
  getLibrary: async (query?: string): Promise<{ items: ProPresenterLibraryItem[]; count: number }> => {
    const params = query ? `?q=${encodeURIComponent(query)}` : '';
    const response = await api.get(`/propresenter/library${params}`);
    return response.data;
  },

  // Get ProPresenter playlists
  getPlaylists: async (): Promise<{ playlists: ProPresenterPlaylist[]; count: number }> => {
    const response = await api.get('/propresenter/playlists');
    return response.data;
  },

  // Send a song to the ProPresenter queue/playlist
  sendToQueue: async (songId: string, songTitle: string, playlistName?: string): Promise<ProPresenterQueueResult> => {
    const response = await api.post<ProPresenterQueueResult>('/propresenter/queue', {
      song_id: songId,
      song_title: songTitle,
      playlist_name: playlistName,
    });
    return response.data;
  },

  // Trigger a song in ProPresenter
  trigger: async (uuid?: string, songTitle?: string): Promise<{ success: boolean; message: string; uuid: string }> => {
    const response = await api.post('/propresenter/trigger', {
      uuid,
      song_title: songTitle,
    });
    return response.data;
  },

  // Advance to next slide
  nextSlide: async (): Promise<{ success: boolean; message: string }> => {
    const response = await api.post('/propresenter/next');
    return response.data;
  },

  // Go to previous slide
  previousSlide: async (): Promise<{ success: boolean; message: string }> => {
    const response = await api.post('/propresenter/previous');
    return response.data;
  },

  // Clear a layer
  clear: async (layer?: string): Promise<{ success: boolean; message: string; layer: string }> => {
    const response = await api.post(`/propresenter/clear${layer ? `?layer=${layer}` : ''}`);
    return response.data;
  },
};

// Bible API types
export interface BibleTranslation {
  id: string;
  name: string;
  nameLocal: string;
  abbreviation: string;
  abbreviationLocal: string;
  description: string;
  descriptionLocal: string;
  language: {
    id: string;
    name: string;
    nameLocal: string;
    script: string;
    scriptDirection: string;
  };
}

export interface BibleBook {
  id: string;
  bibleId: string;
  abbreviation: string;
  name: string;
  nameLong: string;
}

export interface BibleChapter {
  id: string;
  bibleId: string;
  bookId: string;
  number: string;
  reference: string;
}

export interface BibleVerse {
  id: string;
  orgId: string;
  bibleId: string;
  bookId: string;
  chapterId: string;
  reference: string;
  text: string;
}

export interface BiblePassage {
  id: string;
  bibleId: string;
  orgId: string;
  reference: string;
  content: string;
}

export interface BibleChapterContent {
  id: string;
  bibleId: string;
  bookId: string;
  number: string;
  reference: string;
  content: string;
}

// Bible API - proxied through Go backend (per D-04, D-08)
export const bibleApi = {
  // Get all available Bible translations
  getBibles: async (): Promise<BibleTranslation[]> => {
    const response = await api.get<BibleTranslation[]>('/bible/bibles');
    return response.data;
  },

  // Get books for a Bible translation
  getBooks: async (bibleId: string): Promise<BibleBook[]> => {
    const response = await api.get<BibleBook[]>(`/bible/bibles/${bibleId}/books`);
    return response.data;
  },

  // Get chapters for a book
  getChapters: async (bibleId: string, bookId: string): Promise<BibleChapter[]> => {
    const response = await api.get<BibleChapter[]>(`/bible/bibles/${bibleId}/books/${bookId}/chapters`);
    return response.data;
  },

  // Get chapter content (all verses)
  getChapter: async (bibleId: string, chapterId: string): Promise<BibleChapterContent> => {
    const response = await api.get<BibleChapterContent>(`/bible/bibles/${bibleId}/chapters/${chapterId}`);
    return response.data;
  },

  // Get a single verse
  getVerse: async (bibleId: string, verseId: string): Promise<BibleVerse> => {
    const response = await api.get<BibleVerse>(`/bible/bibles/${bibleId}/verses/${verseId}`);
    return response.data;
  },

  // Get a passage (verse range)
  getPassage: async (bibleId: string, passageId: string): Promise<BiblePassage> => {
    const response = await api.get<BiblePassage>(`/bible/bibles/${bibleId}/passages/${passageId}`);
    return response.data;
  },
};

export interface Settings {
  id: number;
  laptop_b_ip: string;
  laptop_b_port: number;
  live_playlist_uuid: string;
  propresenter_host: string;
  propresenter_port: number;
  propresenter_playlist: string;
  propresenter_playlist_uuid: string;
  updated_at: string;
}

export interface UpdateSettingsRequest {
  propresenter_host?: string;
  propresenter_port?: number;
  propresenter_playlist?: string;
  propresenter_playlist_uuid?: string;
}

export const settingsApi = {
  // Get settings
  get: async (): Promise<Settings> => {
    const response = await api.get<Settings>('/settings');
    return response.data;
  },

  // Update settings
  update: async (data: UpdateSettingsRequest): Promise<Settings> => {
    const response = await api.put<Settings>('/settings', data);
    return response.data;
  },
};

// Queue Management
export interface QueueItem {
  id: number;
  song_id: string;
  position: number;
  song?: Song;
  created_at: string;
  updated_at: string;
}

export interface AddToQueueRequest {
  song_id: string;
}

export interface ReorderQueueRequest {
  items: { id: number; position: number }[];
}

export const queueApi = {
  // Get all queue items
  getAll: async (): Promise<QueueItem[]> => {
    const response = await api.get<QueueItem[]>('/queue');
    return response.data;
  },

  // Add a song to the queue
  add: async (songId: string): Promise<QueueItem> => {
    const response = await api.post<QueueItem>('/queue', { song_id: songId });
    return response.data;
  },

  // Remove an item from the queue by queue item ID
  remove: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/queue/${id}`);
    return response.data;
  },

  // Remove an item from the queue by song ID
  removeBySongId: async (songId: string): Promise<{ message: string }> => {
    const response = await api.delete<{ message: string }>(`/queue/song/${songId}`);
    return response.data;
  },

  // Reorder queue items
  reorder: async (items: { id: number; position: number }[]): Promise<{ message: string }> => {
    const response = await api.put<{ message: string }>('/queue/reorder', { items });
    return response.data;
  },

  // Clear the entire queue
  clear: async (): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/queue/clear');
    return response.data;
  },
};

// Live output state — scripture shown on the LED wall output page.
// Server-backed (not BroadcastChannel) because the output browser typically
// runs on a different machine (Resolume/media PC) than the operator.
export interface LiveScriptureColumn {
  abbreviation: string;
  reference: string;
  content: string;
  indic: boolean;
}

export interface LiveScripture {
  columns: LiveScriptureColumn[] | null;
  visible: boolean;
  updated_at: number;
}

export interface LiveSuggestion {
  reference: string;
  from: string;
  bibles?: string[];
  updated_at: number;
}

export const liveApi = {
  getSuggestion: async (): Promise<LiveSuggestion> => {
    const response = await api.get<LiveSuggestion>('/live/suggestion');
    return response.data;
  },

  setSuggestion: async (reference: string, from: string, bibles?: string[]): Promise<LiveSuggestion> => {
    const response = await api.post<LiveSuggestion>('/live/suggestion', { reference, from, bibles });
    return response.data;
  },

  getScripture: async (): Promise<LiveScripture> => {
    const response = await api.get<LiveScripture>('/live/scripture');
    return response.data;
  },

  setScripture: async (columns: LiveScriptureColumn[]): Promise<LiveScripture> => {
    const response = await api.post<LiveScripture>('/live/scripture', { columns });
    return response.data;
  },

  clearScripture: async (): Promise<LiveScripture> => {
    const response = await api.delete<LiveScripture>('/live/scripture');
    return response.data;
  },

  getOutputConfig: async (): Promise<OutputConfig> => {
    const response = await api.get<OutputConfig>('/live/output-config');
    return response.data;
  },

  setOutputConfig: async (cfg: { blur: number; box_scale: number }): Promise<OutputConfig> => {
    const response = await api.put<OutputConfig>('/live/output-config', cfg);
    return response.data;
  },
};

// Resolume/OBS wall-output layout, set by media/admin, read by /output/bible.
export interface OutputConfig {
  blur: number;       // backdrop blur radius in px
  box_scale: number;  // 0.5..1.0 fraction of the side panel the box fills
  updated_at: number;
}

export default api;
