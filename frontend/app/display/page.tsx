'use client';

import { useEffect, useState, useRef } from 'react';
import { Song } from '@/lib/api';
import SplitLyricsView from '@/components/SplitLyricsView';

type DisplaySong = Pick<Song, 'id' | 'title' | 'artist' | 'lyrics' | 'content' | 'language'>;

export default function Display() {
  const [song, setSong] = useState<DisplaySong | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load alignment preference from localStorage
  useEffect(() => {
    const savedAlign = localStorage.getItem('lyrics-text-align');
    if (savedAlign === 'left' || savedAlign === 'center' || savedAlign === 'right') {
      setTextAlign(savedAlign);
    }
  }, []);
  
  // Listen for alignment changes from main page
  useEffect(() => {
    const channel = new BroadcastChannel('lyrics-display');
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'alignment' && event.data.textAlign) {
        setTextAlign(event.data.textAlign);
      }
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, []);

  // Auto-hide controls after inactivity
  useEffect(() => {
    const handleActivity = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);

    // Initial timeout
    handleActivity();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Load last pushed song from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('lyrics-display-current');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as DisplaySong;
        setSong(parsed);
      } catch (_) {
        // ignore parse errors
      }
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom controls
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => Math.min(prev + 0.1, 10.0));
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomLevel(prev => Math.max(prev - 0.1, 0.3));
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoomLevel(1.0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for broadcasts from the control window
  useEffect(() => {
    const channel = new BroadcastChannel('lyrics-display');
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'song' && data.song) {
        setSong(data.song as DisplaySong);
        localStorage.setItem('lyrics-display-current', JSON.stringify(data.song));
      }
      if (data?.type === 'clear') {
        setSong(null);
        localStorage.removeItem('lyrics-display-current');
      }
      if (data?.type === 'zoom' && typeof data.zoomLevel === 'number') {
        setZoomLevel(data.zoomLevel);
      }
    };
    return () => channel.close();
  }, []);

  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden relative">
      {/* Floating Controls */}
      <div 
        className={`
          absolute top-4 right-4 z-50 flex items-center gap-2
          transition-opacity duration-300
          ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-gray-800/80 backdrop-blur-sm rounded-lg px-2 py-1 border border-gray-600">
          <button
            onClick={() => setZoomLevel(prev => Math.max(prev - 0.1, 0.5))}
            className="w-8 h-8 flex items-center justify-center text-white hover:bg-gray-700 rounded transition-colors"
            title="Zoom Out (-)"
          >
            −
          </button>
          <span className="text-sm text-gray-300 w-12 text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel(prev => Math.min(prev + 0.1, 2.0))}
            className="w-8 h-8 flex items-center justify-center text-white hover:bg-gray-700 rounded transition-colors"
            title="Zoom In (+)"
          >
            +
          </button>
          <button
            onClick={() => setZoomLevel(1.0)}
            className="text-xs text-gray-400 hover:text-white px-2 transition-colors"
            title="Reset Zoom (0)"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div 
        className={`
          absolute bottom-4 right-4 z-50 
          bg-gray-900/80 backdrop-blur-sm text-gray-400 text-xs px-3 py-2 rounded-lg
          transition-opacity duration-300
          ${showControls ? 'opacity-100' : 'opacity-0'}
        `}
      >
        <span className="text-cyan-400">+/-</span> Zoom • 
        <span className="text-gray-400">0</span> Reset
      </div>

      {/* Main Content - Always use SplitLyricsView which supports 1+ panes */}
      {song ? (
        <SplitLyricsView lyrics={song.lyrics} zoomLevel={zoomLevel} textAlign={textAlign} />
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <p className="text-gray-500 text-base sm:text-lg md:text-xl">
              Waiting for song...
            </p>
            <p className="text-gray-600 text-sm mt-2">
              Select a song in the control window
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
