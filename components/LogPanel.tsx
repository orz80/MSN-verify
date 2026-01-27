import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
}

const LogPanel: React.FC<LogPanelProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-surface rounded-lg border border-gray-800 flex flex-col h-64 md:h-full overflow-hidden">
      <div className="p-3 border-b border-gray-800 bg-gray-900/50 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Detection Logs</h3>
        <span className="text-xs text-gray-500">{logs.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-gray-600 text-center mt-10 italic">Waiting for events...</div>
        ) : (
          logs.map((log) => (
            <div 
              key={log.id} 
              className={`p-2 rounded border-l-2 flex items-start gap-2 ${
                log.type === 'success' ? 'bg-green-900/10 border-green-500 text-green-200' :
                log.type === 'error' ? 'bg-red-900/10 border-red-500 text-red-200' :
                log.type === 'warning' ? 'bg-yellow-900/10 border-yellow-500 text-yellow-200' :
                'bg-gray-800/30 border-gray-600 text-gray-400'
              }`}
            >
              <span className="opacity-50 whitespace-nowrap">[{log.timestamp.toLocaleTimeString()}]</span>
              <span className="flex-1">{log.message}</span>
              {log.confidence !== undefined && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  log.confidence > 0.8 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {(log.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default LogPanel;