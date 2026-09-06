'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FaceBox, CompareResponse, PixelStats, compareFaces, detectFace,
  enrollIdentity, EnrollResult,
} from '../services/api';
import { FaceOverlay } from './FaceOverlay';
import { PixelInspectionPanel } from './PixelInspectionPanel';

interface Props {
  onNotify?: (msg: string) => void;
}

export function FaceComparisonView({ onNotify }: Props) {
  // Image A (Camera or Live Capture)
  const [imageA, setImageA] = useState<string | null>(null);
  const [faceABoxes, setFaceABoxes] = useState<FaceBox[]>([]);
  const [dimsA, setDimsA] = useState({ width: 640, height: 480 });
  const [useCameraA, setUseCameraA] = useState<boolean>(true);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isMirroredA, setIsMirroredA] = useState<boolean>(true);
  const [isFrozenA, setIsFrozenA] = useState<boolean>(false);
  const [statusMessageA, setStatusMessageA] = useState<string>('STARTING CAMERA...');
  const [pixelStatsA, setPixelStatsA] = useState<PixelStats | undefined>(undefined);
  const [rgbCropA, setRgbCropA] = useState<string | undefined>(undefined);
  const [grayCropA, setGrayCropA] = useState<string | undefined>(undefined);
  const [eqCropA, setEqCropA] = useState<string | undefined>(undefined);

  // Image B (Reference / Social Post Image)
  const [imageB, setImageB] = useState<string | null>(null);
  const [faceBBoxes, setFaceBBoxes] = useState<FaceBox[]>([]);
  const [dimsB, setDimsB] = useState({ width: 640, height: 480 });
  const [statusMessageB, setStatusMessageB] = useState<string>('NO IMAGE');
  const [pixelStatsB, setPixelStatsB] = useState<PixelStats | undefined>(undefined);
  const [rgbCropB, setRgbCropB] = useState<string | undefined>(undefined);
  const [grayCropB, setGrayCropB] = useState<string | undefined>(undefined);
  const [eqCropB, setEqCropB] = useState<string | undefined>(undefined);

  // Pipeline execution & results
  const [threshold, setThreshold] = useState<number>(1.128);
  const [autoRecord, setAutoRecord] = useState<boolean>(true);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [result, setResult] = useState<CompareResponse | null>(null);

  /* Enrolment. A confirmed 1-to-1 result is the cleanest evidence the
     system ever gets that two photos are the same person - both images are
     in hand and a human has just judged the verdict. Storing that pair is
     what lets a later, different photo of them be recognised. */
  const [comparedA, setComparedA] = useState<string | null>(null);
  const [enrollName, setEnrollName] = useState<string>('');
  const [enrollAuthorized, setEnrollAuthorized] = useState<boolean>(false);
  const [enrollBusy, setEnrollBusy] = useState<boolean>(false);
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null);
  const [enrollError, setEnrollError] = useState<string>('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Video refs for Image A
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSamplingRef = useRef<boolean>(false);

  // Camera start / stop for Live input A
  useEffect(() => {
    let active = true;

    async function startCamera() {
      if (!useCameraA) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        if (active) {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play();
              setIsCameraActive(true);
              setStatusMessageA('CAMERA ACTIVE');
            };
          }
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setIsCameraActive(false);
        setStatusMessageA('CAMERA ERROR / PERMISSION DENIED');
      }
    }

    if (useCameraA) {
      startCamera();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsCameraActive(false);
    }

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [useCameraA]);

  // Continuous face detection loop on live webcam stream (samples ~3 times a second)
  useEffect(() => {
    if (!useCameraA || !isCameraActive || isFrozenA || isComparing) return;

    const interval = setInterval(async () => {
      if (isSamplingRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      try {
        isSamplingRef.current = true;
        const detectRes = await detectFace(dataUrl);
        setFaceABoxes(detectRes.faces || []);
        setDimsA({ width: detectRes.image_width || 640, height: detectRes.image_height || 480 });
        setStatusMessageA(detectRes.status_message || (detectRes.face_detected ? '1 FACE DETECTED' : 'SEARCHING...'));
        if (detectRes.pixel_stats) setPixelStatsA(detectRes.pixel_stats);
        if (detectRes.rgb_crop_base64) setRgbCropA(detectRes.rgb_crop_base64);
        if (detectRes.grayscale_crop_base64) setGrayCropA(detectRes.grayscale_crop_base64);
        if (detectRes.equalized_crop_base64) setEqCropA(detectRes.equalized_crop_base64);
      } catch (err) {
        // Dev silence
      } finally {
        isSamplingRef.current = false;
      }
    }, 350);

    return () => clearInterval(interval);
  }, [useCameraA, isCameraActive, isFrozenA, isComparing]);

  // Capture / Freeze frame from camera
  const captureCameraFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setImageA(dataUrl);
    setIsFrozenA(true);

    detectFace(dataUrl)
      .then((res) => {
        setFaceABoxes(res.faces || []);
        setDimsA({ width: res.image_width || 640, height: res.image_height || 480 });
        setStatusMessageA('FRAME CAPTURED');
        if (res.pixel_stats) setPixelStatsA(res.pixel_stats);
        if (res.rgb_crop_base64) setRgbCropA(res.rgb_crop_base64);
        if (res.grayscale_crop_base64) setGrayCropA(res.grayscale_crop_base64);
        if (res.equalized_crop_base64) setEqCropA(res.equalized_crop_base64);
      })
      .catch((err) => console.error('Detection A error:', err));
  }, []);

  const unfreezeCamera = () => {
    setIsFrozenA(false);
    setImageA(null);
  };

  // Handle file uploads for Image A
  const handleUploadA = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      setImageA(dataUrl);
      setUseCameraA(false);
      setIsFrozenA(false);
      try {
        const res = await detectFace(dataUrl);
        setFaceABoxes(res.faces || []);
        setDimsA({ width: res.image_width || 640, height: res.image_height || 480 });
        setStatusMessageA(res.status_message || 'IMAGE A LOADED');
        if (res.pixel_stats) setPixelStatsA(res.pixel_stats);
        if (res.rgb_crop_base64) setRgbCropA(res.rgb_crop_base64);
        if (res.grayscale_crop_base64) setGrayCropA(res.grayscale_crop_base64);
        if (res.equalized_crop_base64) setEqCropA(res.equalized_crop_base64);
      } catch (err) {
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle file uploads for Image B (Reference)
  const handleUploadB = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      setImageB(dataUrl);
      try {
        const res = await detectFace(dataUrl);
        setFaceBBoxes(res.faces || []);
        setDimsB({ width: res.image_width || 640, height: res.image_height || 480 });
        setStatusMessageB(res.status_message || 'REFERENCE IMAGE LOADED');
        if (res.pixel_stats) setPixelStatsB(res.pixel_stats);
        if (res.rgb_crop_base64) setRgbCropB(res.rgb_crop_base64);
        if (res.grayscale_crop_base64) setGrayCropB(res.grayscale_crop_base64);
        if (res.equalized_crop_base64) setEqCropB(res.equalized_crop_base64);
      } catch (err) {
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  };

  // Run 1-to-1 comparison pipeline
  const handleCompare = async () => {
    let sourceA = imageA;
    if (useCameraA && isCameraActive && !isFrozenA && videoRef.current && canvasRef.current) {
      captureCameraFrame();
      const canvas = canvasRef.current;
      sourceA = canvas.toDataURL('image/jpeg', 0.9);
    }

    if (!sourceA) {
      alert('Please provide Live Camera frame or Image A');
      return;
    }
    if (!imageB) {
      alert('Please upload a Reference / Social Media Image (Image B)');
      return;
    }

    try {
      setIsComparing(true);
      setResult(null);
      // A fresh comparison invalidates the previous enrolment panel, the
      // same way the discovery tab clears its review box on every run.
      setEnrollResult(null);
      setEnrollError('');
      setEnrollName('');
      setComparedA(sourceA);
      const res = await compareFaces(sourceA, imageB, threshold, autoRecord);
      setResult(res);
      if (res.face_a_box) setFaceABoxes([res.face_a_box]);
      if (res.face_b_box) setFaceBBoxes([res.face_b_box]);
      if (res.pixel_stats_a) setPixelStatsA(res.pixel_stats_a);
      if (res.pixel_stats_b) setPixelStatsB(res.pixel_stats_b);
      if (res.rgb_crop_a_base64) setRgbCropA(res.rgb_crop_a_base64);
      if (res.grayscale_crop_a_base64) setGrayCropA(res.grayscale_crop_a_base64);
      if (res.equalized_crop_a_base64) setEqCropA(res.equalized_crop_a_base64);
      if (res.rgb_crop_b_base64) setRgbCropB(res.rgb_crop_b_base64);
      if (res.grayscale_crop_b_base64) setGrayCropB(res.grayscale_crop_b_base64);
      if (res.equalized_crop_b_base64) setEqCropB(res.equalized_crop_b_base64);
    } catch (err: any) {
      alert(`Comparison failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsComparing(false);
    }
  };

  const handleEnroll = async () => {
    if (!comparedA || !imageB || !enrollName.trim()) return;
    setEnrollBusy(true);
    setEnrollError('');
    try {
      const res = await enrollIdentity(
        [comparedA, imageB],
        enrollName.trim(),
        `Enrolled from a confirmed 1-to-1 verification at L2 ${result?.euclidean_distance?.toFixed(4)}.`,
        enrollAuthorized,
        threshold,
      );
      setEnrollResult(res);
    } catch (e: any) {
      setEnrollError(e?.message || 'Enrolment failed');
    } finally {
      setEnrollBusy(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', width: '100%' }}>

      {/* Top Banner / Pipeline Description */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(32, 36, 26, 0.70) 0%, var(--surface-raised) 100%)',
        border: '1px solid rgba(212, 175, 55, 0.2)',
        borderRadius: '16px',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.25rem', color: '#f4f6f0' }}> 1-to-1 Biometric Verification Engine
            </h3>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.62)', fontSize: '0.875rem' }}> Compare a <strong>Live Camera Face (A)</strong> with a <strong>Reference / Social Post Image (B)</strong>. Extracts normalized 128D embeddings, evaluates Euclidean & Cosine similarity metrics, and commits proof on-chain.
            </p>
          </div>

          {/* Controls Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.78)' }}>
              <span>Threshold (Dist &le; {threshold.toFixed(2)}):</span>
              <input
                type="range"
                min="0.60"
                max="1.40"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                style={{ accentColor: '#d4af37', cursor: 'pointer', width: '100px' }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.78)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRecord}
                onChange={(e) => setAutoRecord(e.target.checked)}
                style={{ accentColor: '#7fd6a2' }}
              />
              <span>Auto-Commit Proof On-Chain</span>
            </label>
          </div>
        </div>

        {/* Interactive 7-Step Pipeline Stepper */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          background: 'rgba(0, 0, 0, 0.35)',
          padding: '10px 14px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.62)',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 500, color: '#d4af37', letterSpacing: '0.05em' }}>PIPELINE:</span>
          <span> Image Ingestion</span>
          <span> Face Detection</span>
          <span style={{ color: '#9ce0b8', fontWeight: 500, background: 'rgba(127, 214, 162, 0.14)', border: '1px solid rgba(127, 214, 162, 0.28)', padding: '2px 8px', borderRadius: '4px' }}> Grayscale & Equalization
          </span>
          <span> 128D Embedding</span>
          <span> Similarity Check</span>
          <span> SHA-256 Digest</span>
          <span style={{ color: '#7fd6a2', fontWeight: 500 }}> Smart Contract Anchor</span>
        </div>
      </div>

      {/* Dual Video / Image Ingestion Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '24px',
      }}>

        {/* PANEL A: LIVE CAMERA / INPUT A */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{
            background: '#171a13',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: '#d4af37',
                  color: '#000',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}>A</span>
                <h4 style={{ margin: 0, fontSize: '1rem', color: '#ffffff' }}>Live Camera / Ingestion A</h4>
              </div>

              {/* Action buttons: Mirror Flip + Toggle Camera/Upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>

                {useCameraA && (
                  <button
                    onClick={() => setIsMirroredA((prev) => !prev)}
                    title="Toggle Camera Mirroring"
                    style={{
                      background: isMirroredA ? 'rgba(212, 175, 55, 0.18)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${isMirroredA ? '#d4af37' : 'rgba(255,255,255,0.2)'}`,
                      color: isMirroredA ? '#d4af37' : 'rgba(255,255,255,0.62)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 400,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>{isMirroredA ? 'Mirrored' : 'Unmirrored'}</span>
                  </button>
                )}

                <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '6px' }}>
                  <button
                    onClick={() => {
                      setUseCameraA(true);
                      setIsFrozenA(false);
                    }}
                    style={{
                      background: useCameraA ? '#d4af37' : 'transparent',
                      color: useCameraA ? '#000000' : 'rgba(255,255,255,0.62)',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 400,
                      cursor: 'pointer',
                    }}
                  > Live
                  </button>
                  <label style={{
                    background: !useCameraA ? '#d4af37' : 'transparent',
                    color: !useCameraA ? '#000000' : 'rgba(255,255,255,0.62)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    display: 'inline-block',
                  }}> Upload
                    <input type="file" accept="image/*" onChange={handleUploadA} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            </div>

            {/* Viewport Box */}
            <div style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/3',
              background: '#12140f',
              borderRadius: '12px',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {useCameraA && !isFrozenA ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: isMirroredA ? 'scaleX(-1)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                  <FaceOverlay
                    faces={faceABoxes}
                    objectFit="cover"
                    imageWidth={videoRef.current?.videoWidth || dimsA.width}
                    imageHeight={videoRef.current?.videoHeight || dimsA.height}
                    isMirrored={isMirroredA}
                    color="#d4af37"
                  />
                </>
              ) : imageA ? (
                <>
                  <img
                    src={imageA}
                    alt="Source A"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      transform: (useCameraA && isMirroredA) ? 'scaleX(-1)' : 'none',
                    }}
                  />
                  <FaceOverlay
                    faces={faceABoxes}
                    objectFit="contain"
                    imageWidth={dimsA.width}
                    imageHeight={dimsA.height}
                    isMirrored={useCameraA && isMirroredA}
                    color="#d4af37"
                  />
                </>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.44)', fontSize: '0.875rem' }}>No image loaded</div>
              )}

              {/* Status chip */}
              <div style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                background: 'rgba(0,0,0,0.7)',
                backdropFilter: 'blur(4px)',
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                color: '#d4af37',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: faceABoxes.length > 0 ? '#7fd6a2' : '#e8c46a' }} />
                {statusMessageA}
              </div>
            </div>

            {useCameraA && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {!isFrozenA ? (
                  <button
                    onClick={captureCameraFrame}
                    style={{
                      flex: 1,
                      background: 'rgba(212, 175, 55, 0.15)',
                      border: '1px solid #d4af37',
                      color: '#d4af37',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '0.8125rem',
                      fontWeight: 400,
                      cursor: 'pointer',
                    }}
                  > Snapshot Frame A
                  </button>
                ) : (
                  <button
                    onClick={unfreezeCamera}
                    style={{
                      flex: 1,
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: '#f4f6f0',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '0.8125rem',
                      fontWeight: 400,
                      cursor: 'pointer',
                    }}
                  > Resume Live Camera
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Grayscale Transforms & Pixel Matrix Inspection for Face A */}
          <PixelInspectionPanel
            title="Image A — Grayscale & Pixel Matrix Data"
            pixelStats={pixelStatsA}
            rgbCropBase64={rgbCropA}
            grayscaleCropBase64={grayCropA}
            equalizedCropBase64={eqCropA}
            accentColor="#d4af37"
          />
        </div>

        {/* PANEL B: REFERENCE / SOCIAL MEDIA POST IMAGE */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{
            background: '#171a13',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  background: '#d3e3bb',
                  color: '#000',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}>B</span>
                <h4 style={{ margin: 0, fontSize: '1rem', color: '#ffffff' }}>Reference / Social Post Image (B)</h4>
              </div>

              <label style={{
                background: '#d3e3bb',
                color: '#000000',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}> Choose File
                <input type="file" accept="image/*" onChange={handleUploadB} style={{ display: 'none' }} />
              </label>
            </div>

            {/* Viewport Box */}
            <div style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/3',
              background: '#12140f',
              borderRadius: '12px',
              overflow: 'hidden',
              border: '2px dashed var(--rule-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {imageB ? (
                <>
                  <img src={imageB} alt="Reference B" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  <FaceOverlay
                    faces={faceBBoxes}
                    objectFit="contain"
                    imageWidth={dimsB.width}
                    imageHeight={dimsB.height}
                    isMirrored={false}
                    color="#d3e3bb"
                  />
                </>
              ) : (
                <label style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'rgba(255,255,255,0.44)',
                  cursor: 'pointer',
                  padding: '24px',
                  textAlign: 'center',
                }}>
                  <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.62)' }}>Upload social media post image / reference photo</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>PNG, JPG, WebP supported</span>
                  <input type="file" accept="image/*" onChange={handleUploadB} style={{ display: 'none' }} />
                </label>
              )}

              {/* Status chip */}
              {imageB && (
                <div style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: '8px',
                  background: 'rgba(0,0,0,0.7)',
                  backdropFilter: 'blur(4px)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  color: '#d3e3bb',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: faceBBoxes.length > 0 ? '#7fd6a2' : '#e08585' }} />
                  {statusMessageB}
                </div>
              )}
            </div>

            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', textAlign: 'center' }}>
              {imageB ? 'Reference image loaded and ready for comparison' : 'Select a reference face to compare against'}
            </div>
          </div>

          {/* Grayscale Transforms & Pixel Matrix Inspection for Face B */}
          <PixelInspectionPanel
            title="Image B — Grayscale & Pixel Matrix Data"
            pixelStats={pixelStatsB}
            rgbCropBase64={rgbCropB}
            grayscaleCropBase64={grayCropB}
            equalizedCropBase64={eqCropB}
            accentColor="#d3e3bb"
          />
        </div>

      </div>

      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Compare Action Button */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={handleCompare}
          disabled={isComparing || !imageB}
          style={{
            background: isComparing
              ? 'rgba(212, 175, 55, 0.5)'
              : 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)',
            color: '#000000',
            border: 'none',
            padding: '18px 48px',
            borderRadius: '12px',
            fontSize: '1.25rem',
            fontWeight: 500,
            cursor: isComparing || !imageB ? 'not-allowed' : 'pointer',
            boxShadow: '0 8px 24px rgba(212, 175, 55, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            transition: 'transform 0.15s ease',
          }}
        >
          {isComparing ? (
            <>
              <span className="spinner" style={{
                display: 'inline-block',
                width: '20px',
                height: '20px',
                border: '3px solid rgba(0,0,0,0.3)',
                borderTopColor: '#000',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span>Extracting 128D Embeddings & Verifying...</span>
            </>
          ) : (
            <>
              <span>Compare Embeddings & Verify Proof</span>
            </>
          )}
        </button>
      </div>

      {/* VERIFICATION RESULTS PANEL */}
      {result && (
        <div style={{
          background: '#171a13',
          borderRadius: '24px',
          border: `2px solid ${result.is_match ? '#7fd6a2' : '#e08585'}`,
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxShadow: result.is_match
            ? '0 12px 36px rgba(127, 214, 162, 0.16)'
            : '0 12px 36px rgba(224, 133, 133, 0.18)',
        }}>

          {/* Header Verdict Badge & Similarity Score */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            paddingBottom: '20px',
          }}>
            <div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: result.is_match ? 'rgba(127, 214, 162, 0.14)' : 'rgba(224, 133, 133, 0.14)',
                border: `1px solid ${result.is_match ? '#7fd6a2' : '#e08585'}`,
                color: result.is_match ? '#9ce0b8' : '#e89a9a',
                fontWeight: 500,
                fontSize: '1.25rem',
              }}>
                <span>{result.is_match ? '' : ''}</span>
                <span>{result.is_match ? 'IDENTITY MATCH VERIFIED' : 'IDENTITY MISMATCH'}</span>
              </div>
              <p style={{ margin: '8px 0 0 0', color: 'rgba(255,255,255,0.62)', fontSize: '0.875rem' }}>
                {result.status_message}
              </p>
            </div>

            {/* Similarity Score Meter */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.62)', textTransform: 'uppercase', letterSpacing: '0.05em' }}> Biometric Similarity
              </div>
              <div style={{
                fontSize: '2.5rem',
                fontWeight: 900,
                color: result.is_match ? '#9ce0b8' : '#e89a9a',
                lineHeight: 1.1,
              }}>
                {result.similarity_percentage.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
          }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>EUCLIDEAN DISTANCE (L2)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 500, color: '#f4f6f0', marginTop: '4px' }}>
                {result.euclidean_distance.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', marginTop: '2px' }}> Threshold: &le; {result.threshold_used.toFixed(2)}
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>COSINE SIMILARITY</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 500, color: '#f4f6f0', marginTop: '4px' }}>
                {result.cosine_similarity.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', marginTop: '2px' }}> Range: [-1.0, 1.0]
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>VECTOR DIMENSIONS</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 500, color: '#f4f6f0', marginTop: '4px' }}> 128D &times; 2
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', marginTop: '2px' }}> Normalized Unit Sphere
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div style={{ fontSize: '0.75rem', color: '#9ce0b8' }}>GRAYSCALE PRE-PROCESSING</div>
              <div style={{ fontSize: '1.125rem', fontWeight: 500, color: '#c3ead4', marginTop: '6px' }}> 8-Bit Gray + Equalized
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', marginTop: '2px' }}> cv2.COLOR_BGR2GRAY + equalizeHist
              </div>
            </div>
          </div>

          {/* 128D Embedding Numerical Heatmap Preview */}
          {result.embedding_a.length > 0 && result.embedding_b.length > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'rgba(255,255,255,0.78)', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                <span>128-Dimensional Vector Representation Heatmaps</span>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>Vector A (Top) vs Vector B (Bottom)</span>
              </div>

              {/* Embedding A Spectrum */}
              <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px' }}>
                {result.embedding_a.map((val, idx) => {
                  const intensity = Math.min(255, Math.max(0, Math.floor((val + 0.3) * 300)));
                  return (
                    <div
                      key={`a-${idx}`}
                      title={`Dim ${idx}: ${val}`}
                      style={{
                        flex: 1,
                        background: `rgb(${intensity}, ${Math.floor(intensity * 0.8)}, ${Math.floor(intensity * 0.2)})`,
                      }}
                    />
                  );
                })}
              </div>

              {/* Embedding B Spectrum */}
              <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden' }}>
                {result.embedding_b.map((val, idx) => {
                  const intensity = Math.min(255, Math.max(0, Math.floor((val + 0.3) * 300)));
                  return (
                    <div
                      key={`b-${idx}`}
                      title={`Dim ${idx}: ${val}`}
                      style={{
                        flex: 1,
                        background: `rgb(${Math.floor(intensity * 0.2)}, ${Math.floor(intensity * 0.7)}, ${intensity})`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Cryptographic SHA-256 Digest Card */}
          <div style={{
            background: 'rgba(0,0,0,0.4)',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#d4af37', fontWeight: 500, letterSpacing: '0.05em' }}> CANONICAL VERIFICATION RECORD (SHA-256)
              </span>
              <button
                onClick={() => copyToClipboard(result.record_hash, 'hash')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.62)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {copiedHash === 'hash' ? 'Copied' : 'Copy Hash'}
              </button>
            </div>
            <code style={{
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              color: '#d3e3bb',
              wordBreak: 'break-all',
              background: 'rgba(0,0,0,0.3)',
              padding: '8px 12px',
              borderRadius: '6px',
            }}>
              {result.record_hash}
            </code>
          </div>

          {/* Blockchain On-Chain Anchor Card */}
          {result.blockchain_result && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(127, 214, 162, 0.08) 0%, rgba(127, 214, 162, 0.12) 100%)',
              border: '1px solid rgba(127, 214, 162, 0.28)',
              borderRadius: '16px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#9ce0b8', display: 'flex', alignItems: 'center', gap: '6px' }}> EVM Smart Contract Confirmation
                </span>
                <span style={{
                  background: result.blockchain_result.simulated ? 'transparent' : '#7fd6a2',
                  color: result.blockchain_result.simulated ? '#e8c46a' : '#000000',
                  border: result.blockchain_result.simulated
                    ? '1px solid rgba(232,196,106,0.5)' : 'none',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                }}>
                  {result.blockchain_result.simulated
                    ? 'simulated - not broadcast'
                    : result.blockchain_result.status}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', fontSize: '0.8125rem' }}>
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.44)' }}>Transaction Hash: </span>
                  <code style={{ color: '#c3ead4', wordBreak: 'break-all' }}>{result.blockchain_result.transaction_hash}</code>
                </div>
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.44)' }}>Network: </span>
                  <span style={{ color: '#ffffff' }}>{result.blockchain_result.network}</span>
                </div>
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.44)' }}>Block Number: </span>
                  <span style={{ color: '#ffffff' }}>
                    {result.blockchain_result.block_number
                      ? '#' + result.blockchain_result.block_number
                      : 'not mined'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.44)' }}>Timestamp: </span>
                  <span style={{ color: 'rgba(255,255,255,0.62)' }}>{result.blockchain_result.timestamp}</span>
                </div>
              </div>
            </div>
          )}

          {/* REMEMBER THIS PERSON.
              A verified pair is the strongest evidence the system gets that
              two photos show the same face, so it is the right moment to store
              them. Both images go in, and the backend re-checks the second
              against the first before storing - the operator's word alone is
              not enough, because one mislabelled reference would make this
              identity wrong for good.

              Enrolled photos improve recognition only. They are marked
              not-web-reachable, so they can never be served back as a
              "discovered post". */}
          {result.is_match && comparedA && imageB && (
            <div style={{
              background: 'rgba(20, 23, 16, 0.85)',
              border: '1px solid var(--rule-strong)',
              borderRadius: '16px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div>
                <div style={{ fontSize: '0.95rem', color: '#f4f6f0' }}>Remember this person</div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
                  Stores both photos under one name. A later photo of them is then
                  scored against whichever of these references is closest, which is
                  what lets an older or differently-lit picture still match.
                </p>
              </div>

              {!enrollResult && (
                <>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                      placeholder="Name for this identity"
                      style={{
                        flex: 1, minWidth: 200,
                        background: 'var(--surface-sunken)',
                        border: '1px solid var(--rule)',
                        borderRadius: '8px',
                        padding: '0.5rem 0.7rem',
                        color: '#f4f6f0',
                        fontSize: '0.82rem',
                        fontFamily: 'inherit',
                      }}
                    />
                    <button
                      onClick={handleEnroll}
                      disabled={enrollBusy || !enrollName.trim() || !enrollAuthorized}
                      style={{
                        background: (!enrollName.trim() || !enrollAuthorized)
                          ? 'rgba(255,255,255,0.06)'
                          : 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)',
                        color: (!enrollName.trim() || !enrollAuthorized) ? 'rgba(255,255,255,0.35)' : '#12140f',
                        border: 'none', borderRadius: '8px',
                        padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 500,
                        cursor: (enrollBusy || !enrollName.trim() || !enrollAuthorized) ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {enrollBusy ? 'Enrolling...' : 'Enrol both photos'}
                    </button>
                  </div>

                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    fontSize: '0.72rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.5,
                  }}>
                    <input
                      type="checkbox"
                      checked={enrollAuthorized}
                      onChange={(e) => setEnrollAuthorized(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      I am authorised to store these images as biometric reference data.
                      An enrolled identity can be deleted at any time via{' '}
                      <code>DELETE /api/social/gallery/&lt;name&gt;</code>.
                    </span>
                  </label>
                </>
              )}

              {enrollError && (
                <div style={{ fontSize: '0.75rem', color: '#e89a9a' }}>{enrollError}</div>
              )}

              {enrollResult && (
                <div style={{ fontSize: '0.78rem', color: '#a9e3b4', lineHeight: 1.6 }}>
                  Stored &ldquo;{enrollResult.identity}&rdquo; &mdash; {enrollResult.added_now} photo
                  {enrollResult.added_now === 1 ? '' : 's'} added, {enrollResult.total_references} reference
                  {enrollResult.total_references === 1 ? '' : 's'} on file.
                  {enrollResult.rejected.length > 0 && (
                    <div style={{ color: '#e8c46a', marginTop: 4 }}>
                      {enrollResult.rejected.length} image rejected:{' '}
                      {enrollResult.rejected.map((r) => r.reason).join('; ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
