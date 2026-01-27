export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  confidence?: number;
}

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DetectionResult {
  detected: boolean;
  confidence: number;
  boundingBox?: BoundingBox;
}

export enum AppStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  PAUSED = 'PAUSED',
}

export interface MonitorConfig {
  apiKey: string; // Store comma-separated keys here
  checkInterval: number; // in milliseconds
  confidenceThreshold: number; // 0 to 1
  soundEnabled: boolean;
}

export interface TargetImage {
  id: string;
  src: string;
}