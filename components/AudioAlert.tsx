import React, { useCallback, useImperativeHandle, forwardRef, useRef } from 'react';

export interface AudioAlertHandle {
  playAlert: () => void;
  initialize: () => void;
}

const AudioAlert = forwardRef<AudioAlertHandle, {}>((props, ref) => {
  const audioContextRef = useRef<AudioContext | null>(null);

  const initialize = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.error("Audio resume failed", e));
    }
  }, []);

  const playAlert = useCallback(() => {
    // Ensure initialized
    if (!audioContextRef.current) {
      initialize();
    }
    
    const ctx = audioContextRef.current;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    try {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(500, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio playback error", e);
    }
  }, [initialize]);

  useImperativeHandle(ref, () => ({
    playAlert,
    initialize
  }));

  return null;
});

AudioAlert.displayName = 'AudioAlert';
export default AudioAlert;