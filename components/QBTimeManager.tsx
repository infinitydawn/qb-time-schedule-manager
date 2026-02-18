'use client';

import React, { useState } from 'react';
import { useQBTime, QBTimePM } from '@/hooks/useQBTime';

interface QBTimeManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const QBTimeManager: React.FC<QBTimeManagerProps> = ({ isOpen, onClose }) => {
  const {
    loading,
    error,
    isConnected,
    projectManagers,
    connectToQB,
    fetchProjectManagers,
    disconnect
  } = useQBTime();

  const [token, setToken] = useState('');

  const handleConnect = async () => {
    if (!token.trim()) return;
    const success = await connectToQB(token.trim());
    if (success) {
      setToken('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">QuickBooks Time</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Connection Status */}
        <div className="mb-6 p-4 bg-gray-50 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-3 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="font-medium">
                {isConnected ? 'Connected to QuickBooks Time' : 'Not Connected'}
              </span>
            </div>
            {isConnected && (
              <button
                onClick={disconnect}
                className="px-3 py-2 bg-red-500 text-white text-sm rounded-md hover:bg-red-600 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Token input — shown when not connected */}
        {!isConnected && (
          <div className="mb-6 p-4 border border-gray-200 rounded-md">
            <h3 className="text-lg font-semibold mb-3">Connect with API Token</h3>
            <p className="text-sm text-gray-500 mb-3">
              Paste your TSheets / QuickBooks Time API bearer token below.
            </p>
            <div className="flex gap-3">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="S.abc123…"
              />
              <button
                onClick={handleConnect}
                disabled={loading || !token.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
              >
                {loading ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {/* Project Managers list */}
        {isConnected && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                Project Managers ({projectManagers.length})
              </h3>
              <button
                onClick={fetchProjectManagers}
                disabled={loading}
                className="px-3 py-2 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600 transition-colors disabled:bg-gray-300"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {loading && projectManagers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">Loading project managers…</div>
            ) : projectManagers.length > 0 ? (
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 font-medium">Name</th>
                      <th className="text-left p-3 font-medium">QB ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectManagers.map((pm) => (
                      <tr key={pm.id} className="border-t border-gray-200">
                        <td className="p-3">{pm.name}</td>
                        <td className="p-3 text-gray-500">{pm.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No PMs found in &quot;PROJECT MANAGERS&quot; group
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QBTimeManager;