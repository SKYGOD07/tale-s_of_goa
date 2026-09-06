'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { SylvaHeroBackground } from '../components/SylvaHeroBackground';
import { IntroExperience } from '../components/IntroExperience';
import { CameraView } from '../components/CameraView';
import { TestImageUpload } from '../components/TestImageUpload';
import { DetectionStatus, PipelineStatus } from '../components/DetectionStatus';
import { CaptureButton } from '../components/CaptureButton';
import { EmbeddingPanel } from '../components/EmbeddingPanel';
import { FaceComparisonView } from '../components/FaceComparisonView';
import { PixelInspectionPanel } from '../components/PixelInspectionPanel';
import { SocialDiscoveryPipeline } from '../components/SocialDiscoveryPipeline';
import {
  detectFace,
  encodeFace,
  enrollIdentity,
  recordVerification,
  getChainStatus,
  ChainStatus,
  FaceBox,
  PixelStats,
  VerificationResponse,
} from '../services/api';

/* ═══════════════════════════════════════════════════════════════════
   Only the presentation layer lives in this file's markup. Every
   handler, state hook and API call below is unchanged from the
   original pipeline implementation.
   ═══════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'pipeline' as const, idx: '01', label: 'Automated discovery' },
  { key: 'compare' as const, idx: '02', label: '1-to-1 verification' },
  { key: 'register' as const, idx: '03', label: 'Registration & proof' },
];

/** A labelled hairline-separated statistic. Used across the header rail. */
function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      <span
        style={{
          fontSize: 'var(--t-small)',
          color: tone || 'var(--ink-strong)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'compare' | 'register'>('pipeline');
  /* The intro opens itself once per browser; this only forces it back open
     when the operator asks for it from the header. */
  const [introOpen, setIntroOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);

  // Single Face Registration State
  const [mode, setMode] = useState<'camera' | 'test_image'>('camera');
  const [testImage, setTestImage] = useState<string | null>(null);
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const [imageWidth, setImageWidth] = useState<number>(640);
  const [imageHeight, setImageHeight] = useState<number>(480);
  const [statusMessage, setStatusMessage] = useState<string>('INITIALIZING...');
  const [pixelStats, setPixelStats] = useState<PixelStats | undefined>(undefined);
  const [rgbCrop, setRgbCrop] = useState<string | undefined>(undefined);
  const [grayCrop, setGrayCrop] = useState<string | undefined>(undefined);
  const [eqCrop, setEqCrop] = useState<string | undefined>(undefined);

  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({
    cameraReady: false,
    cameraError: null,
    faceDetected: false,
    faceCount: 0,
    embeddingGenerated: false,
    embeddingDimension: null,
    hashCreated: false,
    blockchainConnected: true,
    verificationConfirmed: false,
    isProcessing: false,
  });

  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [embedding, setEmbedding] = useState<number[]>([]);
  const [recordHash, setRecordHash] = useState<string>('');
  const [verificationResult, setVerificationResult] = useState<VerificationResponse | null>(null);

  /* Registration is the natural enrolment point: it is the one place the
     operator supplies a name alongside a face. Naming a capture stores it as a
     reference for that identity, so the discovery pipeline recognises the
     person directly instead of depending on a search engine having indexed
     them. Leaving the name blank still produces the on-chain proof — the
     capture is simply not remembered. */
  const [registerName, setRegisterName] = useState<string>('');
  const [registerAuthorized, setRegisterAuthorized] = useState<boolean>(false);
  const [enrollNote, setEnrollNote] = useState<string>('');

  // Periodically check Python FastAPI backend status (every 3 seconds)
  useEffect(() => {
    const checkBackend = () => {
      fetch('http://localhost:8000/')
        .then((res) => res.json())
        .then(() => setBackendOnline(true))
        .catch(() => setBackendOnline(false));
    };

    checkBackend();
    const interval = setInterval(checkBackend, 3000);
    return () => clearInterval(interval);
  }, []);

  // Chain reachability is polled far less often than the backend ping — each
  // check costs a round trip to the Sepolia RPC endpoint.
  useEffect(() => {
    if (!backendOnline) return;
    let cancelled = false;
    const read = () => {
      getChainStatus()
        .then((s) => { if (!cancelled) setChain(s); })
        .catch(() => { if (!cancelled) setChain(null); });
    };
    read();
    const interval = setInterval(read, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [backendOnline]);

  // Handle camera status changes
  const handleCameraStatusChange = useCallback((ready: boolean, error: string | null) => {
    setPipelineStatus((prev) => ({
      ...prev,
      cameraReady: ready,
      cameraError: error,
    }));
  }, []);

  // Continuous frame detection handler
  const handleFrameCaptured = useCallback(
    async (base64Image: string) => {
      setCurrentFrame(base64Image);
      try {
        setPipelineStatus((prev) => ({ ...prev, isProcessing: true }));
        const detectRes = await detectFace(base64Image);

        setFaces(detectRes.faces || []);
        setImageWidth(detectRes.image_width || 640);
        setImageHeight(detectRes.image_height || 480);
        setStatusMessage(detectRes.status_message || 'PROCESSING');
        if (detectRes.pixel_stats) setPixelStats(detectRes.pixel_stats);
        if (detectRes.rgb_crop_base64) setRgbCrop(detectRes.rgb_crop_base64);
        if (detectRes.grayscale_crop_base64) setGrayCrop(detectRes.grayscale_crop_base64);
        if (detectRes.equalized_crop_base64) setEqCrop(detectRes.equalized_crop_base64);

        setPipelineStatus((prev) => ({
          ...prev,
          faceDetected: detectRes.face_detected,
          faceCount: detectRes.face_count,
          isProcessing: false,
        }));
      } catch (err) {
        setPipelineStatus((prev) => ({ ...prev, isProcessing: false }));
      }
    },
    []
  );

  // Handle test image upload
  const handleTestImageSelected = async (base64Image: string) => {
    setTestImage(base64Image);
    setCurrentFrame(base64Image);
    try {
      setPipelineStatus((prev) => ({ ...prev, isProcessing: true }));
      const detectRes = await detectFace(base64Image);
      setFaces(detectRes.faces || []);
      setImageWidth(detectRes.image_width || 640);
      setImageHeight(detectRes.image_height || 480);
      setStatusMessage(detectRes.status_message || 'IMAGE PROCESSED');
      if (detectRes.pixel_stats) setPixelStats(detectRes.pixel_stats);
      if (detectRes.rgb_crop_base64) setRgbCrop(detectRes.rgb_crop_base64);
      if (detectRes.grayscale_crop_base64) setGrayCrop(detectRes.grayscale_crop_base64);
      if (detectRes.equalized_crop_base64) setEqCrop(detectRes.equalized_crop_base64);

      setPipelineStatus((prev) => ({
        ...prev,
        faceDetected: detectRes.face_detected,
        faceCount: detectRes.face_count,
        isProcessing: false,
      }));
    } catch (err) {
      setPipelineStatus((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  // Single Face Capture & On-Chain Verification
  const handleCaptureAndVerify = async () => {
    if (!currentFrame) return;

    try {
      setPipelineStatus((prev) => ({ ...prev, isProcessing: true }));
      setStatusMessage('EXTRACTING 128D FACE VECTOR...');

      const encodeRes = await encodeFace(currentFrame);

      if (!encodeRes.success) {
        alert(`Encoding failed: ${encodeRes.error || 'Invalid face region'}`);
        setPipelineStatus((prev) => ({ ...prev, isProcessing: false }));
        return;
      }

      setEmbedding(encodeRes.embedding);
      setRecordHash(encodeRes.record_hash);
      if (encodeRes.pixel_stats) setPixelStats(encodeRes.pixel_stats);
      if (encodeRes.rgb_crop_base64) setRgbCrop(encodeRes.rgb_crop_base64);
      if (encodeRes.grayscale_crop_base64) setGrayCrop(encodeRes.grayscale_crop_base64);
      if (encodeRes.equalized_crop_base64) setEqCrop(encodeRes.equalized_crop_base64);

      setPipelineStatus((prev) => ({
        ...prev,
        embeddingGenerated: true,
        embeddingDimension: encodeRes.embedding_dimension,
        hashCreated: true,
      }));

      setStatusMessage('SUBMITTING RECORD TO EVM BLOCKCHAIN...');

      const verifyRes = await recordVerification(encodeRes.record_hash);
      setVerificationResult(verifyRes);

      setPipelineStatus((prev) => ({
        ...prev,
        verificationConfirmed: verifyRes.success,
        isProcessing: false,
      }));

      setStatusMessage(
        verifyRes.simulated ? 'RECORDED IN SIMULATION — NOT BROADCAST' : 'FACE ID VERIFICATION CONFIRMED'
      );

      // Enrolment is separate from the proof and must not be able to break it:
      // the record is already on-chain by this point, so a failure here is
      // reported without unwinding a verification that genuinely happened.
      if (registerName.trim()) {
        try {
          const en = await enrollIdentity(
            [currentFrame],
            registerName.trim(),
            'Enrolled from the registration page.',
            registerAuthorized,
          );
          setEnrollNote(
            `Remembered as “${en.identity}” — ${en.total_references} reference ` +
            `photo${en.total_references === 1 ? '' : 's'} on file.`
          );
        } catch (e: any) {
          setEnrollNote(`Proof recorded, but enrolment failed: ${e?.message || 'unknown error'}`);
        }
      } else {
        setEnrollNote('');
      }
    } catch (err: any) {
      console.error('[Capture & Verify Error]', err);
      alert(`Pipeline error: ${err.message || 'Verification failed'}`);
      setPipelineStatus((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  /* ── Chain badge state ───────────────────────────────────────────── */
  const chainTone = !chain
    ? 'tag--dead'
    : chain.live
      ? 'tag--live'
      : chain.connected
        ? 'tag--warn'
        : 'tag--dead';

  const chainLabel = !chain
    ? 'Chain unknown'
    : chain.live
      ? `${chain.network} · live`
      : chain.connected
        ? `${chain.network} · simulated`
        : 'RPC unreachable';

  return (
    <>
      <IntroExperience open={introOpen} onClose={() => setIntroOpen(false)} />

      <SylvaHeroBackground />

      {/* Column guides, echoing the scene's own grid */}
      <div className="guides" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>

      <main
        style={{
          position: 'relative',
          zIndex: 2,
          minHeight: '100svh',
          padding: '28px 20px 80px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: 1240, display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* ── Masthead ──────────────────────────────────────────────── */}
          <header
            className="rise"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              minHeight: 'min(84svh, 760px)',
              paddingBottom: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                gap: 20,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span className="eyebrow">HH Goa 2026</span>
                  <span style={{ width: 28, height: 1, background: 'var(--rule-bright)' }} />
                  <span className="tag tag--brand">Task 03</span>
                  {/* The intro shows itself once, then lives here. Someone
                      returning after a week should not have to remember how
                      the pipeline is meant to be driven. */}
                  <button
                    className="pill press"
                    onClick={() => setIntroOpen(true)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--rule-strong)',
                      borderRadius: 999,
                      color: 'var(--ink-faint)',
                      padding: '3px 12px',
                      fontSize: 'var(--t-micro)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    How it works
                  </button>
                </div>

                <h1
                  style={{
                    fontSize: 'var(--t-display)',
                    letterSpacing: '-0.035em',
                    lineHeight: 1,
                    color: 'var(--ink)',
                  }}
                >
                  Face identification
                  <span style={{ color: 'var(--ink-faint)' }}> &amp; on-chain proof</span>
                </h1>

                <p
                  style={{
                    marginTop: 12,
                    maxWidth: '58ch',
                    color: 'var(--ink-soft)',
                    fontSize: 'var(--t-body)',
                  }}
                >
                  A 128-dimensional biometric embedding, reduced to a canonical SHA-256 record
                  hash and anchored to an Ethereum smart contract. The blockchain receives no
                  image or vector.
                </p>
              </div>

              {/* Status rail */}
              <div
                className="panel"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 22,
                  padding: '14px 20px',
                  borderRadius: 'var(--radius)',
                }}
              >
                <Stat
                  label="Backend"
                  tone={backendOnline ? 'var(--live)' : 'var(--dead)'}
                  value={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span
                        className="dot dot--pulse"
                        style={{ color: backendOnline ? 'var(--live)' : 'var(--dead)' }}
                      />
                      {backendOnline === null ? 'Checking' : backendOnline ? 'FastAPI :8000' : 'Offline'}
                    </span>
                  }
                />
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule-strong)' }} />
                <Stat
                  label="Network"
                  tone={
                    chain?.live ? 'var(--live)' : chain?.connected ? 'var(--warn)' : 'var(--dead)'
                  }
                  value={
                    chain?.explorer_url ? (
                      <a
                        href={chain.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ borderBottom: '1px solid var(--rule-bright)' }}
                      >
                        {chainLabel}
                      </a>
                    ) : (
                      chainLabel
                    )
                  }
                />
                {chain?.block_number != null && (
                  <>
                    <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule-strong)' }} />
                    <Stat
                      label="Block"
                      value={<span className="mono">#{chain.block_number.toLocaleString('en-US')}</span>}
                    />
                  </>
                )}
              </div>
            </div>

            {/* ── Tabs ────────────────────────────────────────────────── */}
            <div
              role="tablist"
              aria-label="Pipeline sections"
              style={{
                display: 'flex',
                gap: 4,
                paddingTop: 16,
                borderTop: '1px solid var(--rule)',
                flexWrap: 'wrap',
                marginTop: 'auto',
              }}
            >
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className="pill"
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span className="idx">{tab.idx}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </header>

          {/* ── Backend offline guidance ──────────────────────────────── */}
          {backendOnline === false && (
            <div
              className="panel rise"
              style={{
                padding: '18px 22px',
                borderColor: 'rgba(224, 133, 133, 0.28)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 14,
              }}
            >
              <div>
                <div style={{ color: 'var(--dead)', marginBottom: 2 }}>
                  The FastAPI backend on port 8000 is not responding
                </div>
                <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-small)', margin: 0 }}>
                  Detection, encoding and blockchain calls are unavailable until it is running.
                </p>
              </div>
              <code
                className="panel-sunken"
                style={{
                  padding: '8px 14px',
                  color: 'var(--leaf)',
                  fontSize: 'var(--t-small)',
                }}
              >
                cd backend &amp;&amp; .venv\Scripts\python run.py
              </code>
            </div>
          )}

          {/* ── Simulated-chain notice ────────────────────────────────── */}
          {backendOnline && chain && !chain.live && (
            <div
              className="panel rise"
              style={{
                padding: '16px 22px',
                borderColor: 'rgba(232, 196, 106, 0.24)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span className="tag tag--warn">Simulated</span>
              <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-small)', margin: 0, flex: 1, minWidth: 260 }}>
                {chain.message} Proofs will be generated locally and marked as not broadcast.
              </p>
            </div>
          )}

          {/* ── TAB 01: automated discovery ───────────────────────────── */}
          {activeTab === 'pipeline' && (
            <div className="enter" role="tabpanel" key="pipeline">
              <SocialDiscoveryPipeline />
            </div>
          )}

          {/* ── TAB 02: 1-to-1 comparison ─────────────────────────────── */}
          {activeTab === 'compare' && (
            <div className="enter" role="tabpanel" key="compare">
              <FaceComparisonView />
            </div>
          )}

          {/* ── TAB 03: registration & on-chain proof ─────────────────── */}
          {activeTab === 'register' && (
            <div
              className="enter"
              role="tabpanel"
              key="register"
              style={{ display: 'flex', flexDirection: 'column', gap: 32 }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                  gap: 40,
                  alignItems: 'start',
                }}
              >
                {/* Method */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 6 }}>
                  <div>
                    <span className="eyebrow">Method</span>
                    <h2 style={{ fontSize: 'var(--t-title)', marginTop: 10 }}>
                      From pixels to a 32-byte commitment
                    </h2>
                  </div>

                  <ol
                    style={{
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0,
                      counterReset: 'step',
                    }}
                  >
                    {[
                      {
                        t: 'Detect',
                        d: 'YuNet returns the facial bounding box and five landmarks — both eyes, the nose tip and the mouth corners.',
                      },
                      {
                        t: 'Align',
                        d: 'SFace.alignCrop() warps the face onto those landmarks, producing a 112×112 colour crop with the eyes in a fixed position. A plain resize instead of this step is what made earlier matching unreliable.',
                      },
                      {
                        t: 'Embed',
                        d: 'SFace encodes the aligned crop as a 128-dimensional identity vector. Match decisions use L2 distance against SFace’s published operating point of 1.128.',
                      },
                      {
                        t: 'Remember & commit',
                        d: 'Named captures are stored as a reference for this identity, and the canonical record is hashed with SHA-256 and written to the smart contract. Only the 32-byte hash goes on-chain — never the image or the vector.',
                      },
                    ].map((step, i) => (
                      <li
                        key={step.t}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '38px 1fr',
                          gap: 14,
                          padding: '16px 0',
                          borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                        }}
                      >
                        <span
                          className="mono"
                          style={{ color: 'var(--gold)', fontSize: 'var(--t-micro)', paddingTop: 4 }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <div style={{ color: 'var(--ink)', marginBottom: 3 }}>{step.t}</div>
                          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-small)', margin: 0 }}>
                            {step.d}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Ingestion */}
                <div
                  className="panel"
                  style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <span className="eyebrow">Source</span>
                      <h3 style={{ fontSize: 'var(--t-heading)', marginTop: 4 }}>Single face ingestion</h3>
                    </div>

                    <div
                      role="tablist"
                      aria-label="Capture source"
                      style={{
                        display: 'flex',
                        gap: 2,
                        padding: 3,
                        borderRadius: 999,
                        border: '1px solid var(--rule)',
                        background: 'var(--surface-sunken)',
                      }}
                    >
                      <button
                        role="tab"
                        aria-selected={mode === 'camera'}
                        className="pill"
                        style={{ padding: '6px 14px', fontSize: 'var(--t-micro)' }}
                        onClick={() => setMode('camera')}
                      >
                        Camera
                      </button>
                      <button
                        role="tab"
                        aria-selected={mode === 'test_image'}
                        className="pill"
                        style={{ padding: '6px 14px', fontSize: 'var(--t-micro)' }}
                        onClick={() => setMode('test_image')}
                      >
                        Upload
                      </button>
                    </div>
                  </div>

                  <div className="panel-sunken" style={{ padding: 4, overflow: 'hidden' }}>
                    {mode === 'camera' ? (
                      <CameraView
                        onFrameCaptured={handleFrameCaptured}
                        faces={faces}
                        imageWidth={imageWidth}
                        imageHeight={imageHeight}
                        statusMessage={statusMessage}
                        isProcessing={pipelineStatus.isProcessing}
                        onCameraStatusChange={handleCameraStatusChange}
                      />
                    ) : (
                      <TestImageUpload
                        onImageSelected={handleTestImageSelected}
                        selectedImage={testImage}
                        faces={faces}
                        imageWidth={imageWidth}
                        imageHeight={imageHeight}
                        statusMessage={statusMessage}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <span className="eyebrow">Identity (optional)</span>
                      <input
                        value={registerName}
                        onChange={(e) => setRegisterName(e.target.value)}
                        placeholder="Name — leave blank to record the proof only"
                        style={{
                          width: '100%',
                          marginTop: 6,
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--rule)',
                          borderRadius: 8,
                          padding: '0.5rem 0.7rem',
                          color: 'var(--ink)',
                          fontSize: 'var(--t-small)',
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>

                    {registerName.trim() !== '' && (
                      <label style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        fontSize: 'var(--t-micro)', color: 'var(--ink-faint)', lineHeight: 1.5,
                      }}>
                        <input
                          type="checkbox"
                          checked={registerAuthorized}
                          onChange={(e) => setRegisterAuthorized(e.target.checked)}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          I am authorised to store this face as biometric reference data.
                          Naming a capture keeps a 128-D vector and a thumbnail, never the
                          full photograph; it can be erased with{' '}
                          <code>DELETE /api/social/gallery/&lt;name&gt;</code>.
                        </span>
                      </label>
                    )}

                    <CaptureButton
                      onCapture={handleCaptureAndVerify}
                      disabled={
                        !pipelineStatus.faceDetected ||
                        pipelineStatus.faceCount !== 1 ||
                        (registerName.trim() !== '' && !registerAuthorized)
                      }
                      isProcessing={pipelineStatus.isProcessing}
                      faceCount={pipelineStatus.faceCount}
                    />

                    {enrollNote && (
                      <div style={{
                        fontSize: 'var(--t-micro)',
                        color: enrollNote.startsWith('Proof recorded, but') ? '#e8c46a' : '#a9e3b4',
                        lineHeight: 1.5,
                      }}>
                        {enrollNote}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <PixelInspectionPanel
                title="Grayscale output & pixel inspection"
                pixelStats={pixelStats}
                rgbCropBase64={rgbCrop}
                grayscaleCropBase64={grayCrop}
                equalizedCropBase64={eqCrop}
                accentColor="#d4af37"
              />

              {(pipelineStatus.embeddingGenerated || pipelineStatus.isProcessing) && (
                <section
                  className="rise"
                  style={{
                    borderTop: '1px solid var(--rule)',
                    paddingTop: 28,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 20,
                  }}
                >
                  <div>
                    <span className="eyebrow">Result</span>
                    <h3 style={{ fontSize: 'var(--t-title)', marginTop: 8 }}>
                      Cryptographic biometric proof
                    </h3>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                      gap: 20,
                    }}
                  >
                    <DetectionStatus status={pipelineStatus} />
                    <EmbeddingPanel
                      embedding={embedding}
                      embeddingDimension={pipelineStatus.embeddingDimension || 128}
                      recordHash={recordHash}
                      verificationResult={verificationResult}
                    />
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── Colophon ──────────────────────────────────────────────── */}
          <footer
            style={{
              marginTop: 20,
              paddingTop: 20,
              borderTop: '1px solid var(--rule)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              color: 'var(--ink-ghost)',
              fontSize: 'var(--t-micro)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span>HH Goa 2026 — Task 03</span>
            <span>OpenCV · SFace 128D · SHA-256 · Solidity</span>
          </footer>
        </div>
      </main>
    </>
  );
}
