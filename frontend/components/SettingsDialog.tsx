'use client';

import { useState, useEffect } from 'react';
import { settingsApi, Settings, UpdateSettingsRequest } from '@/lib/api';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

type TabType = 'display' | 'developer';

export default function SettingsDialog({ isOpen, onClose, onSave }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('display');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Developer settings form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState(4031);
  const [playlist, setPlaylist] = useState('Live Queue');
  const [playlistUuid, setPlaylistUuid] = useState('');

  // Display settings form state
  const [fontFamily, setFontFamily] = useState('system-ui');
  const [lineSpacing, setLineSpacing] = useState(1.5);
  const [paragraphSpacing, setParagraphSpacing] = useState(1.0);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      loadDisplaySettings();
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

  const loadDisplaySettings = () => {
    const savedFont = localStorage.getItem('display-font-family');
    const savedSpacing = localStorage.getItem('display-line-spacing');
    const savedParagraphSpacing = localStorage.getItem('display-paragraph-spacing');

    if (savedFont) setFontFamily(savedFont);
    if (savedSpacing) setLineSpacing(parseFloat(savedSpacing));
    if (savedParagraphSpacing) setParagraphSpacing(parseFloat(savedParagraphSpacing));
  };

  const handleSaveDeveloperSettings = async () => {
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

  const handleSaveDisplaySettings = () => {
    localStorage.setItem('display-font-family', fontFamily);
    localStorage.setItem('display-line-spacing', lineSpacing.toString());
    localStorage.setItem('display-paragraph-spacing', paragraphSpacing.toString());

    // Broadcast to display window
    const channel = new BroadcastChannel('lyrics-display');
    channel.postMessage({
      type: 'displaySettings',
      fontFamily,
      lineSpacing,
      paragraphSpacing,
    });
    channel.close();

    onClose();
  };

  const handleSave = () => {
    if (activeTab === 'display') {
      handleSaveDisplaySettings();
    } else {
      handleSaveDeveloperSettings();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-[#1a1b1f] rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">
              Settings
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-300"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-[#2a2c31]">
            <button
              onClick={() => setActiveTab('display')}
              className={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'display'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              Display Settings
            </button>
            <button
              onClick={() => setActiveTab('developer')}
              className={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'developer'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              Developer Settings
            </button>
          </div>

          {/* Content */}
          {loading && activeTab === 'developer' ? (
            <div className="text-center py-8">
              <p className="text-gray-400">Loading settings...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Display Settings Tab */}
              {activeTab === 'display' && (
                <>
                  {/* Font Family */}
                  <div>
                    <label htmlFor="fontFamily" className="block text-sm font-medium text-gray-300 mb-2">
                      Font Family
                    </label>
                    <select
                      id="fontFamily"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-4 py-2 border border-[#2a2c31] rounded-lg
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent
                               bg-[#141518] text-white"
                    >
                      <option value="system-ui">System Default</option>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="'Times New Roman', serif">Times New Roman</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="'Courier New', monospace">Courier New</option>
                      <option value="Verdana, sans-serif">Verdana</option>
                      <option value="Tahoma, sans-serif">Tahoma</option>
                      <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                      <option value="'Comic Sans MS', cursive">Comic Sans MS</option>
                    </select>
                  </div>

                  {/* Line Spacing */}
                  <div>
                    <label htmlFor="lineSpacing" className="block text-sm font-medium text-gray-300 mb-2">
                      Line Spacing: {lineSpacing.toFixed(1)}
                    </label>
                    <input
                      id="lineSpacing"
                      type="range"
                      min="1.0"
                      max="3.0"
                      step="0.1"
                      value={lineSpacing}
                      onChange={(e) => setLineSpacing(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>Tight (1.0)</span>
                      <span>Normal (1.5)</span>
                      <span>Loose (3.0)</span>
                    </div>
                  </div>

                  {/* Paragraph Spacing */}
                  <div>
                    <label htmlFor="paragraphSpacing" className="block text-sm font-medium text-gray-300 mb-2">
                      Paragraph Spacing: {paragraphSpacing.toFixed(1)}em
                    </label>
                    <input
                      id="paragraphSpacing"
                      type="range"
                      min="0.0"
                      max="3.0"
                      step="0.1"
                      value={paragraphSpacing}
                      onChange={(e) => setParagraphSpacing(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>None (0.0)</span>
                      <span>Normal (1.0)</span>
                      <span>Large (3.0)</span>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="bg-[#141518] border border-[#2a2c31] rounded-lg p-4 mt-4">
                    <p className="text-xs text-gray-400 mb-2">Preview:</p>
                    <div
                      style={{
                        fontFamily: fontFamily,
                        lineHeight: lineSpacing,
                      }}
                      className="text-white"
                    >
                      <div style={{ marginBottom: `${paragraphSpacing}em` }}>
                        <p>Amazing grace, how sweet the sound</p>
                        <p>That saved a wretch like me</p>
                        <p>I once was lost, but now I'm found</p>
                        <p>Was blind but now I see</p>
                      </div>
                      <div>
                        <p>Through many dangers, toils and snares</p>
                        <p>I have already come</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Developer Settings Tab */}
              {activeTab === 'developer' && (
                <>
                  <p className="text-sm text-gray-400 mb-4">ProPresenter Integration Settings</p>

                  {/* IP Address */}
                  <div>
                    <label htmlFor="host" className="block text-sm font-medium text-gray-300 mb-2">
                      IP Address
                    </label>
                    <input
                      id="host"
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="e.g., 100.77.173.114"
                      className="w-full px-4 py-2 border border-[#2a2c31] rounded-lg
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent
                               bg-[#141518] text-white"
                    />
                  </div>

                  {/* Port */}
                  <div>
                    <label htmlFor="port" className="block text-sm font-medium text-gray-300 mb-2">
                      Port
                    </label>
                    <input
                      id="port"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(parseInt(e.target.value) || 4031)}
                      placeholder="4031"
                      className="w-full px-4 py-2 border border-[#2a2c31] rounded-lg
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent
                               bg-[#141518] text-white"
                    />
                  </div>

                  {/* Playlist Name */}
                  <div>
                    <label htmlFor="playlist" className="block text-sm font-medium text-gray-300 mb-2">
                      Playlist Name
                    </label>
                    <input
                      id="playlist"
                      type="text"
                      value={playlist}
                      onChange={(e) => setPlaylist(e.target.value)}
                      placeholder="Live Queue"
                      className="w-full px-4 py-2 border border-[#2a2c31] rounded-lg
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent
                               bg-[#141518] text-white"
                    />
                  </div>

                  {/* Playlist UUID (optional) */}
                  <div>
                    <label htmlFor="playlistUuid" className="block text-sm font-medium text-gray-300 mb-2">
                      Playlist UUID (Optional)
                    </label>
                    <input
                      id="playlistUuid"
                      type="text"
                      value={playlistUuid}
                      onChange={(e) => setPlaylistUuid(e.target.value)}
                      placeholder="f47e275e-026b-470d-b582-eeaf129ede50"
                      className="w-full px-4 py-2 border border-[#2a2c31] rounded-lg
                               focus:ring-2 focus:ring-blue-500 focus:border-transparent
                               bg-[#141518] text-white font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Leave empty to auto-detect from playlist name
                    </p>
                  </div>
                </>
              )}

              {/* Error message */}
              {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
                  <p className="text-red-400 text-sm">{error}</p>
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
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
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

