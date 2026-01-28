import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  AlertCircle, 
  Settings2, 
  Activity, 
  Monitor, 
  Volume2, 
  VolumeX,
  Target,
  Plus,
  X,
  Key,
  Cpu,
  Eye,
  ScanEye
} from 'lucide-react';
import { checkFrameForTarget } from './services/geminiService';
import { AppStatus, LogEntry, MonitorConfig, TargetImage, BoundingBox } from './types';
import LogPanel from './components/LogPanel';
import AudioAlert, { AudioAlertHandle } from './components/AudioAlert';

// Utility for unique IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

export default function App() {
  // State
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [targetImages, setTargetImages] = useState<TargetImage[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Config state with localStorage persistence
  const [config, setConfig] = useState<MonitorConfig>(() => {
    try {
      const saved = localStorage.getItem('gamescout_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load config", e);
    }
    return {
      apiKey: '',
      checkInterval: 3000,
      confidenceThreshold: 0.85,
      soundEnabled: true,
    };
  });

  // Save config whenever it changes
  useEffect(() => {
    localStorage.setItem('gamescout_config', JSON.stringify(config));
  }, [config]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const audioAlertRef = useRef<AudioAlertHandle>(null);
  const intervalRef = useRef<number | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  // Helper: Add Log
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', confidence?: number) => {
    setLogs(prev => [...prev.slice(-99), {
      id: generateId(),
      timestamp: new Date(),
      message,
      type,
      confidence
    }]);
  }, []);

  // Helper: Draw Bounding Box
  const drawBoundingBox = (box?: BoundingBox) => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!box) return;

    // Calculate scaling
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = canvas.width / canvas.height;
    
    let drawWidth, drawHeight, startX, startY;

    if (containerRatio > videoRatio) {
      drawHeight = canvas.height;
      drawWidth = drawHeight * videoRatio;
      startY = 0;
      startX = (canvas.width - drawWidth) / 2;
    } else {
      drawWidth = canvas.width;
      drawHeight = drawWidth / videoRatio;
      startX = 0;
      startY = (canvas.height - drawHeight) / 2;
    }

    const x = startX + (box.xmin * drawWidth);
    const y = startY + (box.ymin * drawHeight);
    const w = (box.xmax - box.xmin) * drawWidth;
    const h = (box.ymax - box.ymin) * drawHeight;

    // Stylish Box
    ctx.strokeStyle = '#3b82f6'; // Blue-500
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]); // Dashed line for high-tech look
    ctx.strokeRect(x, y, w, h);
    
    // Corners
    ctx.setLineDash([]);
    ctx.strokeStyle = '#60a5fa'; // Blue-400
    ctx.lineWidth = 3;
    const cornerSize = 20;
    
    // Top Left
    ctx.beginPath(); ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y); ctx.stroke();
    // Top Right
    ctx.beginPath(); ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize); ctx.stroke();
    // Bottom Right
    ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerSize); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerSize, y + h); ctx.stroke();
    // Bottom Left
    ctx.beginPath(); ctx.moveTo(x + cornerSize, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cornerSize); ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.fillRect(x, y - 24, 100, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillText("TARGET MATCH", x + 6, y - 8);
  };

  // Video Stream Handling
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {
        console.error("Error playing video:", e);
        addLog("Error playing video stream", "error");
      });
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
      const ctx = overlayRef.current?.getContext('2d');
      if (ctx && overlayRef.current) {
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
    }
  }, [stream, addLog]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (videoRef.current && overlayRef.current) {
        overlayRef.current.width = videoRef.current.clientWidth;
        overlayRef.current.height = videoRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result && typeof event.target.result === 'string') {
          const newImage: TargetImage = {
            id: generateId(),
            src: event.target.result
          };
          setTargetImages(prev => [...prev, newImage]);
          addLog("Target image added successfully", "info");
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const removeTargetImage = (id: string) => {
    setTargetImages(prev => prev.filter(img => img.id !== id));
    addLog("Target image removed", "info");
  };

  const startCapture = async () => {
    try {
      audioAlertRef.current?.initialize();
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });
      setStream(mediaStream);
      addLog("Screen monitoring started", "info");
      mediaStream.getVideoTracks()[0].onended = () => {
        stopMonitoring();
        addLog("Screen sharing ended by user", "warning");
      };
      setTimeout(() => {
        if (videoRef.current && overlayRef.current) {
          overlayRef.current.width = videoRef.current.clientWidth;
          overlayRef.current.height = videoRef.current.clientHeight;
        }
      }, 500);
    } catch (err) {
      console.error(err);
      addLog("Failed to start screen capture", "error");
    }
  };

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setStatus(AppStatus.IDLE);
    drawBoundingBox(undefined);
    addLog("Monitoring stopped", "info");
  }, [stream, addLog]);

  const checkFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || targetImages.length === 0 || isProcessingRef.current) return;
    if (!config.apiKey) {
      addLog("API Key missing. Check settings.", "error");
      stopMonitoring();
      return;
    }
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.paused || video.ended) return;

    isProcessingRef.current = true;
    const canvas = canvasRef.current;
    
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const scale = Math.min(1, 1024 / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.7);

        addLog(`Analyzing frame...`, "info");
        const result = await checkFrameForTarget(config.apiKey, targetImages.map(img => img.src), frameBase64);

        if (result.detected && result.confidence >= config.confidenceThreshold) {
          addLog("Target Detected!", "success", result.confidence);
          if (config.soundEnabled) audioAlertRef.current?.playAlert();
          drawBoundingBox(result.boundingBox);
        } else {
          drawBoundingBox(undefined);
        }
      }
    } catch (error) {
      console.error("Frame check failed:", error);
      addLog("Frame check failed", "error");
    } finally {
      isProcessingRef.current = false;
    }
  }, [targetImages, config, addLog, stopMonitoring]);

  useEffect(() => {
    if (status === AppStatus.MONITORING && stream && targetImages.length > 0) {
      checkFrame();
      intervalRef.current = window.setInterval(checkFrame, config.checkInterval);
      return () => {
        if (intervalRef.current) window.clearInterval(intervalRef.current);
      };
    }
  }, [status, stream, targetImages, config.checkInterval, checkFrame]);

  const toggleMonitoring = () => {
    if (config.soundEnabled) audioAlertRef.current?.initialize();

    if (status === AppStatus.IDLE || status === AppStatus.PAUSED) {
      if (!config.apiKey) {
        addLog("Gemini API Key is required", "error");
        return;
      }
      if (!stream) {
        addLog("Start screen capture first", "warning");
        return;
      }
      if (targetImages.length === 0) {
        addLog("Upload a target image first", "warning");
        return;
      }
      setStatus(AppStatus.MONITORING);
      addLog("Monitoring active", "success");
    } else {
      setStatus(AppStatus.PAUSED);
      addLog("Monitoring paused", "info");
    }
  };

  return (
    <div className="min-h-screen text-zinc-100 flex flex-col font-sans selection:bg-blue-500/30">
      <AudioAlert ref={audioAlertRef} />
      
      {/* Header */}
      <header className="border-b border-white/5 bg-zinc-900/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
               <ScanEye className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">
                GameScout<span className="text-blue-400">AI</span>
              </h1>
              <div className="text-[10px] text-zinc-500 font-mono leading-none">VISUAL DETECTION SYSTEM</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              status === AppStatus.MONITORING 
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-500'
            }`}>
              <span className={`relative flex h-2 w-2`}>
                {status === AppStatus.MONITORING && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${status === AppStatus.MONITORING ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
              </span>
              {status}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Config */}
        <div className="lg:col-span-3 space-y-6 flex flex-col">
          
          {/* Targets */}
          <div className="bg-zinc-900/50 backdrop-blur-sm rounded-xl border border-white/5 p-5 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                Target Patterns
              </h2>
              <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{targetImages.length}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {targetImages.map((img) => (
                <div key={img.id} className="relative group aspect-video bg-zinc-950 rounded-lg border border-white/10 overflow-hidden">
                  <img src={img.src} alt="Target" className="w-full h-full object-contain" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button 
                      onClick={() => removeTargetImage(img.id)}
                      className="text-white hover:text-red-400 transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
              ))}
              
              <label className="aspect-video flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 hover:border-blue-500/50 hover:bg-blue-500/5 cursor-pointer transition-all group">
                <div className="p-2 rounded-full bg-zinc-800 group-hover:bg-blue-500/20 transition-colors">
                  <Plus className="w-4 h-4 text-zinc-400 group-hover:text-blue-400" />
                </div>
                <span className="text-[10px] text-zinc-500 group-hover:text-blue-400 font-medium">Add Target</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
            
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Upload icons, buttons, or characters you want to detect.
            </p>
          </div>

          {/* Settings */}
          <div className="bg-zinc-900/50 backdrop-blur-sm rounded-xl border border-white/5 p-5 flex flex-col gap-5 shadow-xl flex-1">
             <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-zinc-400" />
                System Config
              </h2>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-zinc-400">Gemini API Key(s)</label>
              <div className="relative">
                <div className="absolute left-3 top-2.5 text-zinc-500">
                  <Key className="w-3.5 h-3.5" />
                </div>
                <input 
                  type="password"
                  placeholder="Paste keys (comma separated)"
                  value={config.apiKey}
                  onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder-zinc-700"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Scan Interval</span>
                <span className="text-zinc-200 font-mono">{config.checkInterval / 1000}s</span>
              </div>
              <input 
                type="range" 
                min="1000" 
                max="10000" 
                step="500"
                value={config.checkInterval}
                onChange={(e) => setConfig(prev => ({ ...prev, checkInterval: parseInt(e.target.value) }))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Confidence Threshold</span>
                <span className="text-zinc-200 font-mono">{Math.round(config.confidenceThreshold * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="0.95" 
                step="0.05"
                value={config.confidenceThreshold}
                onChange={(e) => setConfig(prev => ({ ...prev, confidenceThreshold: parseFloat(e.target.value) }))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
              />
            </div>

             <button 
              onClick={() => {
                setConfig(prev => ({ ...prev, soundEnabled: !prev.soundEnabled }));
                if (!config.soundEnabled) audioAlertRef.current?.initialize();
              }}
              className={`w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all border ${
                config.soundEnabled 
                ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700' 
                : 'bg-zinc-900/50 text-zinc-500 border-zinc-800 hover:text-zinc-400'
              }`}
            >
              {config.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              {config.soundEnabled ? 'Audio Alerts Enabled' : 'Audio Alerts Muted'}
            </button>
          </div>
        </div>

        {/* Center: Video Feed */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="relative bg-black rounded-xl border border-zinc-800 overflow-hidden shadow-2xl flex-1 flex flex-col aspect-video group ring-1 ring-white/5">
            
            {/* Scan Line Animation */}
            {status === AppStatus.MONITORING && (
              <div className="absolute inset-0 z-10 pointer-events-none bg-gradient-to-b from-transparent via-blue-500/10 to-transparent h-[10%] w-full animate-[scan_2s_linear_infinite]" />
            )}

            {stream ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline
                muted 
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 bg-zinc-950/50 relative overflow-hidden">
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at center, #3b82f6 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                <div className="relative z-10 flex flex-col items-center">
                  <div className="p-4 rounded-full bg-zinc-900 border border-zinc-800 mb-4 shadow-xl">
                    <Monitor className="w-8 h-8 text-zinc-600" />
                  </div>
                  <p className="text-sm font-medium text-zinc-500">No Signal Input</p>
                  <p className="text-xs text-zinc-600 mt-1">Select a screen to begin analysis</p>
                </div>
              </div>
            )}

            {/* Overlay Canvas for Bounding Box */}
            <canvas 
              ref={overlayRef} 
              className="absolute inset-0 w-full h-full pointer-events-none z-20"
            />

            {/* Overlay Badges */}
            <div className="absolute top-4 left-4 flex gap-2 z-30">
              {status === AppStatus.MONITORING && (
                <div className="flex items-center gap-1.5 bg-red-500/90 backdrop-blur text-white text-[10px] font-bold px-2.5 py-1 rounded shadow-lg animate-pulse">
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  LIVE ANALYSIS
                </div>
              )}
               {status === AppStatus.PAUSED && (
                <div className="bg-yellow-500/90 backdrop-blur text-black text-[10px] font-bold px-2.5 py-1 rounded shadow-lg">
                  PAUSED
                </div>
              )}
            </div>
            
            {/* Processing Indicator */}
            {isProcessingRef.current && (
               <div className="absolute top-4 right-4 z-30">
                 <Cpu className="w-4 h-4 text-blue-400 animate-spin" />
               </div>
            )}

            {/* Control Bar (Glass) */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 z-30 transition-all duration-300 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0">
              {!stream ? (
                <button 
                  onClick={startCapture}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 shadow-[0_8px_16px_-4px_rgba(59,130,246,0.5)] transition-all hover:scale-105 active:scale-95 border border-blue-400/20"
                >
                  <Monitor className="w-4 h-4" />
                  Select Source
                </button>
              ) : (
                <div className="flex items-center gap-2 p-1.5 bg-zinc-900/80 backdrop-blur-md rounded-full border border-white/10 shadow-2xl">
                  <button 
                    onClick={toggleMonitoring}
                    disabled={targetImages.length === 0}
                    className={`px-5 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-all ${
                      status === AppStatus.MONITORING
                        ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                    } ${targetImages.length === 0 && 'opacity-50 cursor-not-allowed'}`}
                  >
                    {status === AppStatus.MONITORING ? (
                      <><Square className="w-3.5 h-3.5 fill-current" /> Pause</>
                    ) : (
                      <><Play className="w-3.5 h-3.5 fill-current" /> Run AI</>
                    )}
                  </button>
                  
                  <div className="w-px h-6 bg-white/10 mx-1" />
                  
                  <button 
                    onClick={stopMonitoring}
                    className="p-2 rounded-full hover:bg-red-500/20 text-red-400 transition-colors"
                    title="Stop Sharing"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3 flex items-start gap-3">
             <div className="mt-0.5">
               <Eye className="w-4 h-4 text-blue-400" />
             </div>
             <div className="space-y-1">
               <p className="text-xs text-blue-200/80">
                 The AI analyzes visual features. For best results, ensure target images are high contrast and distinct from the background.
               </p>
             </div>
          </div>
        </div>

        {/* Right Column: Logs */}
        <div className="lg:col-span-3 h-[400px] lg:h-auto flex flex-col">
          <LogPanel logs={logs} />
        </div>
      </main>

      {/* Hidden Canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
      
      <style>{`
        @keyframes scan {
          0% { transform: translateY(0%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(1000%); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
