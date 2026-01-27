import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  Upload, 
  AlertCircle, 
  Settings, 
  Activity, 
  Monitor, 
  Volume2, 
  VolumeX,
  Target,
  Plus,
  X
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
  const canvasRef = useRef<HTMLCanvasElement>(null); // For capturing frames
  const overlayRef = useRef<HTMLCanvasElement>(null); // For drawing bounding box
  const audioAlertRef = useRef<AudioAlertHandle>(null);
  const intervalRef = useRef<number | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  // Helper: Add Log
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', confidence?: number) => {
    setLogs(prev => [...prev.slice(-49), {
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

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!box) return;

    // Calculate actual dimensions of video within the element (handling object-fit: contain)
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = canvas.width / canvas.height;
    
    let drawWidth, drawHeight, startX, startY;

    if (containerRatio > videoRatio) {
      // Video is pillarboxed (black bars on sides)
      drawHeight = canvas.height;
      drawWidth = drawHeight * videoRatio;
      startY = 0;
      startX = (canvas.width - drawWidth) / 2;
    } else {
      // Video is letterboxed (black bars on top/bottom)
      drawWidth = canvas.width;
      drawHeight = drawWidth / videoRatio;
      startX = 0;
      startY = (canvas.height - drawHeight) / 2;
    }

    // Map normalized coordinates (0-1) to pixel coordinates
    const x = startX + (box.xmin * drawWidth);
    const y = startY + (box.ymin * drawHeight);
    const w = (box.xmax - box.xmin) * drawWidth;
    const h = (box.ymax - box.ymin) * drawHeight;

    // Draw the box
    ctx.strokeStyle = '#ef4444'; // Red-500
    ctx.lineWidth = 4;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.strokeRect(x, y, w, h);

    // Optional: Draw label
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText("Detected", x, y - 5 > 0 ? y - 5 : y + 20);
  };

  // Effect: Bind stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {
        console.error("Error playing video:", e);
        addLog("Error playing video stream", "error");
      });
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
      // Clear overlay when stream stops
      const ctx = overlayRef.current?.getContext('2d');
      if (ctx && overlayRef.current) {
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
    }
  }, [stream, addLog]);

  // Handle Resize for Overlay Canvas
  useEffect(() => {
    const handleResize = () => {
      if (videoRef.current && overlayRef.current) {
        overlayRef.current.width = videoRef.current.clientWidth;
        overlayRef.current.height = videoRef.current.clientHeight;
      }
    };
    
    window.addEventListener('resize', handleResize);
    // Initial size
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handler: Upload Target Image
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

  // Handler: Remove Target Image
  const removeTargetImage = (id: string) => {
    setTargetImages(prev => prev.filter(img => img.id !== id));
    addLog("Target image removed", "info");
  };

  // Handler: Start Screen Share
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

      // Ensure overlay canvas is sized correctly once video starts
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

  // Logic: Stop Monitoring
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
    drawBoundingBox(undefined); // Clear box
    addLog("Monitoring stopped", "info");
  }, [stream, addLog]);

  // Logic: Check Frame
  const checkFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || targetImages.length === 0 || isProcessingRef.current) return;

    const video = videoRef.current;
    
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.paused || video.ended) {
      return;
    }

    isProcessingRef.current = true;
    const canvas = canvasRef.current;
    
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Limit max resolution
        const scale = Math.min(1, 1024 / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.7);

        addLog(`Analyzing frame against ${targetImages.length} targets...`, "info");
        
        const result = await checkFrameForTarget(targetImages.map(img => img.src), frameBase64);

        if (result.detected && result.confidence >= config.confidenceThreshold) {
          addLog("Target Detected!", "success", result.confidence);
          if (config.soundEnabled) {
            audioAlertRef.current?.playAlert();
          }
          drawBoundingBox(result.boundingBox);
        } else {
          // Clear box if not detected or confidence low
          drawBoundingBox(undefined);
        }
      }
    } catch (error) {
      console.error("Frame check failed:", error);
      addLog("Frame check failed", "error");
    } finally {
      isProcessingRef.current = false;
    }
  }, [targetImages, config, addLog]);

  // Effect: Monitoring Loop
  useEffect(() => {
    if (status === AppStatus.MONITORING && stream && targetImages.length > 0) {
      checkFrame();
      intervalRef.current = window.setInterval(checkFrame, config.checkInterval);
      return () => {
        if (intervalRef.current) {
          window.clearInterval(intervalRef.current);
        }
      };
    }
  }, [status, stream, targetImages, config.checkInterval, checkFrame]);

  // Toggle Status
  const toggleMonitoring = () => {
    if (config.soundEnabled) {
      audioAlertRef.current?.initialize();
    }

    if (status === AppStatus.IDLE || status === AppStatus.PAUSED) {
      if (!stream) {
        addLog("Please start screen capture first", "warning");
        return;
      }
      if (targetImages.length === 0) {
        addLog("Please upload at least one target image", "warning");
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
    <div className="min-h-screen bg-background text-gray-100 flex flex-col font-sans">
      <AudioAlert ref={audioAlertRef} />
      
      {/* Header */}
      <header className="border-b border-gray-800 bg-surface/50 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
              GameScout AI
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${
              status === AppStatus.MONITORING 
                ? 'border-green-500/50 bg-green-500/10 text-green-400 animate-pulse' 
                : 'border-gray-700 bg-gray-800 text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${status === AppStatus.MONITORING ? 'bg-green-500' : 'bg-gray-500'}`} />
              {status}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Controls & Target */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Target Image Panel */}
          <div className="bg-surface rounded-xl p-4 border border-gray-800 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Target className="w-4 h-4 text-accent" />
                Target Images ({targetImages.length})
              </h2>
            </div>
            
            {/* Grid of images */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              {targetImages.map((img) => (
                <div key={img.id} className="relative group aspect-video bg-black/50 rounded-lg border border-gray-700 overflow-hidden">
                  <img src={img.src} alt="Target" className="w-full h-full object-contain" />
                  <button 
                    onClick={() => removeTargetImage(img.id)}
                    className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              
              {/* Add Button */}
              <label className="aspect-video flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 hover:border-primary bg-black/30 hover:bg-black/50 cursor-pointer transition-all group">
                <Plus className="w-6 h-6 text-gray-500 group-hover:text-primary transition-colors" />
                <span className="text-[10px] text-gray-500 group-hover:text-primary font-medium">Add Target</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
            
            <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
              Upload multiple screenshots or crops. The AI will alert if ANY of these images are detected in the stream.
            </p>
          </div>

          {/* Configuration Panel */}
          <div className="bg-surface rounded-xl p-4 border border-gray-800 shadow-xl space-y-4">
             <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-400" />
                Configuration
              </h2>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Check Interval</span>
                <span>{config.checkInterval / 1000}s</span>
              </div>
              <input 
                type="range" 
                min="1000" 
                max="10000" 
                step="500"
                value={config.checkInterval}
                onChange={(e) => setConfig(prev => ({ ...prev, checkInterval: parseInt(e.target.value) }))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Confidence Threshold</span>
                <span>{Math.round(config.confidenceThreshold * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0.1" 
                max="0.95" 
                step="0.05"
                value={config.confidenceThreshold}
                onChange={(e) => setConfig(prev => ({ ...prev, confidenceThreshold: parseFloat(e.target.value) }))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

             <button 
              onClick={() => {
                setConfig(prev => ({ ...prev, soundEnabled: !prev.soundEnabled }));
                if (!config.soundEnabled) {
                  audioAlertRef.current?.initialize();
                }
              }}
              className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                config.soundEnabled ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-500'
              }`}
            >
              {config.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              {config.soundEnabled ? 'Sound Alerts On' : 'Sound Alerts Off'}
            </button>
          </div>
        </div>

        {/* Center: Video Feed */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="relative bg-black rounded-xl border border-gray-800 overflow-hidden shadow-2xl flex-1 flex flex-col aspect-video group">
            
            {stream ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline
                muted 
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-600 bg-gray-900/50">
                <Monitor className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm">No screen signal</p>
              </div>
            )}

            {/* Overlay Canvas for Bounding Box */}
            <canvas 
              ref={overlayRef} 
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            {/* Overlay Status */}
            <div className="absolute top-4 left-4 flex gap-2">
              {status === AppStatus.MONITORING && (
                <div className="bg-red-500/90 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg animate-pulse">
                  REC
                </div>
              )}
            </div>

            {/* Control Bar (Overlaid on bottom) */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 pointer-events-auto">
              {!stream ? (
                <button 
                  onClick={startCapture}
                  className="bg-primary hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
                >
                  <Monitor className="w-4 h-4" />
                  Select Screen
                </button>
              ) : (
                <>
                  <button 
                    onClick={toggleMonitoring}
                    disabled={targetImages.length === 0}
                    className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg transition-transform hover:scale-105 ${
                      status === AppStatus.MONITORING
                        ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    } ${targetImages.length === 0 && 'opacity-50 cursor-not-allowed'}`}
                  >
                    {status === AppStatus.MONITORING ? (
                      <><Square className="w-4 h-4 fill-current" /> Pause Monitor</>
                    ) : (
                      <><Play className="w-4 h-4 fill-current" /> Start Monitor</>
                    )}
                  </button>
                  
                  <button 
                    onClick={stopMonitoring}
                    className="bg-red-600/80 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg"
                  >
                    Stop Share
                  </button>
                </>
              )}
            </div>
          </div>
          
          <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-3">
             <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
             <div className="space-y-1">
               <p className="text-xs text-blue-200">
                 <strong>Pro Tip:</strong> Ensure all target images are distinct. You can monitor buttons, icons, or specific game events simultaneously.
               </p>
             </div>
          </div>
        </div>

        {/* Right Column: Logs */}
        <div className="lg:col-span-3 h-[400px] lg:h-auto">
          <LogPanel logs={logs} />
        </div>
      </main>

      {/* Hidden Canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}