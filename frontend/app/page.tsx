'use client';

import { useState } from 'react';
import SongsPanel from '@/components/SongsPanel';

type Tab = 'songs' | 'bible';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('songs');

  return (
    <div className="min-h-screen bg-[#111214] text-gray-100">
      {/* Tab Bar -- per UI-SPEC Tab Bar component */}
      <div className="border-b border-[#2a2c31]">
        <div className="px-6 flex gap-2">
          <button
            onClick={() => setActiveTab('songs')}
            className={`px-4 h-10 text-sm font-medium transition-colors ${
              activeTab === 'songs'
                ? 'text-gray-100 border-b-2 border-blue-600'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Songs
          </button>
          <button
            onClick={() => setActiveTab('bible')}
            className={`px-4 h-10 text-sm font-medium transition-colors ${
              activeTab === 'bible'
                ? 'text-gray-100 border-b-2 border-blue-600'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Bible
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'songs' && <SongsPanel />}
      {activeTab === 'bible' && (
        <div className="px-6 py-6">
          <div className="bg-[#1a1b1f] rounded-xl border border-[#2a2c31] p-4">
            <h2 className="text-xl font-semibold text-gray-100 mb-2">Select a book to begin</h2>
            <p className="text-sm text-gray-300">Choose a book from the list, or type a reference above to jump directly to a passage.</p>
          </div>
        </div>
      )}
    </div>
  );
}
