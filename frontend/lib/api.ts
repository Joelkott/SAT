import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:8080/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

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
    return response.data;
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

// Admin operations
export const adminApi = {
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
  // If the song doesn't exist in ProPresenter, it will be created from the lyrics
  sendToQueue: async (songId: string, songTitle: string, playlistName?: string, themeName?: string, lyrics?: string): Promise<ProPresenterQueueResult> => {
    const response = await api.post<ProPresenterQueueResult>('/propresenter/queue', {
      song_id: songId,
      song_title: songTitle,
      playlist_name: playlistName,
      theme_name: themeName,
      lyrics: lyrics, // Include lyrics so ProPresenter can create the presentation if needed
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

// Settings
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

export default api;
