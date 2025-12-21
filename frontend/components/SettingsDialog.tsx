'use client';

import { useState, useEffect } from 'react';
import { settingsApi, Settings, UpdateSettingsRequest } from '@/lib/api';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export default function SettingsDialog({ isOpen, onClose, onSave }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState(4031);
  const [playlist, setPlaylist] = useState('Live Queue');
  const [playlistUuid, setPlaylistUuid] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await settingsApi.get();
      setSettings(data);
      setHost(data.propresenter_host || '');
      setPort(data.propresenter_port || 4031);
      setPlaylist(data.propresenter_playlist || 'Live Queue');
      setPlaylistUuid(data.propresenter_playlist_uuid || '');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updates: UpdateSettingsRequest = {
        propresenter_host: host.trim() || undefined,
        propresenter_port: port || undefined,
        propresenter_playlist: playlist.trim() || undefined,
        propresenter_playlist_uuid: playlistUuid.trim() || undefined,
      };
      
      await settingsApi.update(updates);
      if (onSave) {
        onSave();
      }
      onClose();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to save settings';
      const details = err.response?.data?.details;
      setError(details ? `${errorMsg}: ${details}` : errorMsg);
      console.error('Settings save error:', err.response?.data || err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              ProPresenter Settings
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">Loading settings...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* IP Address */}
              <div>
                <label htmlFor="host" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  IP Address
                </label>
                <input
                  id="host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="e.g., 100.77.173.114"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Port */}
              <div>
                <label htmlFor="port" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Port
                </label>
                <input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 4031)}
                  placeholder="4031"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Playlist Name */}
              <div>
                <label htmlFor="playlist" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Playlist Name
                </label>
                <input
                  id="playlist"
                  type="text"
                  value={playlist}
                  onChange={(e) => setPlaylist(e.target.value)}
                  placeholder="Live Queue"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* Playlist UUID (optional) */}
              <div>
                <label htmlFor="playlistUuid" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Playlist UUID (Optional)
                </label>
                <input
                  id="playlistUuid"
                  type="text"
                  value={playlistUuid}
                  onChange={(e) => setPlaylistUuid(e.target.value)}
                  placeholder="f47e275e-026b-470d-b582-eeaf129ede50"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           dark:bg-gray-700 dark:text-white font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Leave empty to auto-detect from playlist name
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

