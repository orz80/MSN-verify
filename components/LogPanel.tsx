import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, Clock, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface LogPanelProps {
  logs: LogEntry[];
}

const LogPanel: React.FC<LogPanelProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getIcon = (type: string) => {
    switch(type) {
      case 'success': return <CheckCircle className="w-3 h-3 text-emerald-400" />;
      case 'error': return <AlertTriangle className="w-3 h-3 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-3 h-3 text-amber-400" />;
      default: return <Info className="w-3 h-3 text-blue-400" />;
    }
  };

  return (
    <div className="bg-zinc-950 rounded-xl border border-white/10 flex flex-col h-full overflow-hidden shadow-xl">
      <div className="p-3 border-b border-white/5 bg-zinc-900/50 flex justify-between items-center backdrop-blur-sm">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
          <Terminal className="w-3 h-3" />
          System Logs
        </h3>
        <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono border border-zinc-700">
          v1.0
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 font-mono text-[11px] scroll-smooth">
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-700 opacity-50 space-y-2">
            <Terminal className="w-8 h-8" />
            <span>Ready for initialization...</span>
          </div>
        ) : (
          logs.map((log) => (
            <div 
              key={log.id} 
              className={`p-2 rounded border border-transparent flex items-start gap-2.5 group transition-colors ${
                log.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10' :
                log.type === 'error' ? 'bg-red-500/5 border-red-500/10 hover:bg-red-500/10' :
                log.type === 'warning' ? 'bg-amber-500/5 border-amber-500/10 hover:bg-amber-500/10' :
                'hover:bg-white/5'
              }`}
            >
              <div className="mt-0.5 opacity-70">{getIcon(log.type)}</div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`font-bold ${
                    log.type === 'success' ? 'text-emerald-400' :
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'warning' ? 'text-amber-400' :
                    'text-blue-400'
                  }`}>
                    {log.type.toUpperCase()}
                  </span>
                  <span className="text-zinc-600 text-[10px] flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                  </span>
                </div>
                
                <p className="text-zinc-300 break-words leading-relaxed">
                  {log.message}
                </p>
              </div>

              {log.confidence !== undefined && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[9px] text-zinc-500">CONF</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                    log.confidence > 0.8 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {(log.confidence * 100).toFixed(0)}%
                  </span>
                </div>
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
