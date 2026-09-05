'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FaceOverlay } from './FaceOverlay';
import { FaceBox } from '../services/api';

/** Longest edge sent to the face detector. The preview stays at full 720p. */
const DETECTION_MAX_WIDTH = 640;

interface CameraViewProps {
  onFrameCaptured: (base64Image: string) => void;
  faces: FaceBox[];
  imageWidth: number;
  imageHeight: number;
  statusMessage: string;
  samplingIntervalMs?: number;
  isProcessing: boolean;
  onCameraStatusChange?: (ready: boolean, error: string | null) => void;
}

export const CameraView: React.FC<CameraViewProps> = ({
  onFrameCaptured,
  faces,
  imageWidth,
  imageHeight,
  statusMessage,
  samplingIntervalMs = 250,
  isProcessing,
  onCameraStatusChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  // Update container dimensions on resize
  const updateDimensions = useCallback(() => {
    if (containerRef.current) {
      setContainerDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions]);

  // Request camera stream
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        setCameraError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setCameraReady(true);
            updateDimensions();
            onCameraStatusChange?.(true, null);
          };
        }
      } catch (err: any) {
        console.error('[Camera Error]', err);
        const errMsg = err?.message || 'Permission denied or no camera device found';
        setCameraError(errMsg);
        setCameraReady(false);
        onCameraStatusChange?.(false, errMsg);
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onCameraStatusChange, updateDimensions]);

  // Frame sampling loop using offscreen canvas
  useEffect(() => {
    if (!cameraReady || cameraError) return;

    const interval = setInterval(() => {
      if (isProcessing) return; // Skip if backend request in flight

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const srcWidth = video.videoWidth || 640;
      const srcHeight = video.videoHeight || 480;

      // The camera is requested at 720p for a sharp preview, but every sampled
      // frame is JPEG-encoded on the main thread and POSTed to the detector.
      // Downscaling to 640px wide first cuts the encode and the payload by
      // roughly 4x; Haar detection gains nothing from the extra resolution.
      const scale = Math.min(1, DETECTION_MAX_WIDTH / srcWidth);
      const width = Math.round(srcWidth * scale);
      const height = Math.round(srcHeight * scale);

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        onFrameCaptured(dataUrl);
      }
    }, samplingIntervalMs);

    return () => clearInterval(interval);
  }, [cameraReady, cameraError, isProcessing, samplingIntervalMs, onFrameCaptured]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '420px',
        background: '#12140f',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {cameraError ? (
        <div style={{ textAlign: 'center', padding: '24px', color: '#e08585' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}> </div>
          <div style={{ fontWeight: 500, fontSize: '1rem', marginBottom: '8px' }}> Camera Access Required
          </div>
          <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.62)', maxWidth: '400px' }}> Camera access is required to generate your Face ID. Please allow camera permissions in your browser settings.
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: isMirrored ? 'scaleX(-1)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />

          <FaceOverlay
            objectFit="cover"
            faces={faces}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            containerWidth={containerDimensions.width}
            containerHeight={containerDimensions.height}
            statusMessage={statusMessage}
            isMirrored={isMirrored}
          />

          {/* Mirror Flip Toggle Button */}
          <button
            onClick={() => setIsMirrored((prev) => !prev)}
            title="Toggle Camera Mirroring"
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: isMirrored ? 'rgba(212, 175, 55, 0.2)' : 'rgba(0,0,0,0.6)',
              border: `1px solid ${isMirrored ? '#d4af37' : 'rgba(255,255,255,0.2)'}`,
              color: isMirrored ? '#d4af37' : 'rgba(255,255,255,0.62)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '0.75rem',
              fontWeight: 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backdropFilter: 'blur(8px)',
              zIndex: 10,
            }}
          >
            <span>{isMirrored ? 'Mirrored' : 'Unmirrored'}</span>
          </button>

          {/* Status banner */}
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              background: 'rgba(14, 16, 12, 0.85)',
              backdropFilter: 'blur(8px)',
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#f4f6f0',
              fontSize: '0.75rem',
              fontWeight: 400,
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: faces.length === 1 ? '#7fd6a2' : faces.length > 1 ? '#e8c46a' : '#e08585',
              }}
            />
            {statusMessage || 'SEARCHING FOR FACE...'}
          </div>
        </>
      )}
    </div>
  );
};
