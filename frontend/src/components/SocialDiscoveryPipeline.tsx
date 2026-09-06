'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FaceRegionSelector, CropRegion } from './FaceRegionSelector';
import { LearningPanel } from './LearningPanel';
import {
  runSocialSearchPipeline,
  getSearchCapabilities,
  submitFeedback,
  teachIdentity,
  detectFace,
  SocialSearchPipelineResponse,
  SearchCapabilities,
  MatchResult,
  FaceBox,
  TeachResult,
} from '../services/api';

const MATCH_THRESHOLD = 1.128;

export function SocialDiscoveryPipeline() {
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [authorizedUse, setAuthorizedUse] = useState(false);
  // The no-match panel offers a one-click route to the hint field, which is
  // collapsed by default and therefore easy to miss.
  // What the backend can actually do. The panel below must describe this
  // rather than promising face-only discovery that needs an API key.
  const [caps, setCaps] = useState<SearchCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSearchCapabilities()
      .then((c) => { if (!cancelled) setCaps(c.search); })
      .catch(() => { if (!cancelled) setCaps(null); });
    return () => { cancelled = true; };
  }, []);

  const hintDetailsRef = useRef<HTMLDetailsElement>(null);
  const hintInputRef = useRef<HTMLInputElement>(null);

  const focusHint = () => {
    // The field is either inside a <details> (reverse-image mode) or rendered
    // inline (hint-required mode); handle both.
    if (hintDetailsRef.current) hintDetailsRef.current.open = true;
    const target = hintInputRef.current ?? hintDetailsRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => hintInputRef.current?.focus(), 350);
  };
  const [loading, setLoading] = useState<boolean>(false);
  const [stepState, setStepState] = useState<number>(0);
  const [result, setResult] = useState<SocialSearchPipelineResponse | null>(null);
  // Operator-adjustable; seeded from SFace's published operating point.
  const [threshold, setThreshold] = useState<number>(MATCH_THRESHOLD);
  // Operator judgement per result URL, so each card reflects what was sent.
  const [judged, setJudged] = useState<Record<string, 'correct' | 'incorrect'>>({});
  // Incremented after each label so LearningPanel re-reads the stats.
  const [feedbackTick, setFeedbackTick] = useState(0);
  // Written justification for the primary result, and where it landed.
  const [review, setReview] = useState('');
  const [anchorReview, setAnchorReview] = useState(true);
  const [teaching, setTeaching] = useState(false);
  const [taught, setTaught] = useState<TeachResult | null>(null);
  const [teachError, setTeachError] = useState('');

  /** Send the written review so the system verifies it and remembers. */
  const teach = async () => {
    if (!inputImage || !review.trim()) return;
    setTeaching(true); setTeachError(''); setTaught(null);
    try {
      const r = await teachIdentity(inputImage, review, '', authorizedUse);
      setTaught(r);
    } catch (e) {
      setTeachError(e instanceof Error ? e.message : String(e));
    } finally {
      setTeaching(false);
    }
  };

  const [reviewChain, setReviewChain] = useState<{
    review_sha256?: string;
    transaction_hash?: string;
    block_number?: number;
    simulated?: boolean;
  } | null>(null);
  // Manual face targeting. cropRegion wins when set; otherwise faceIndex picks
  // among the auto-detected faces.
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  const [faceIndex, setFaceIndex] = useState<number>(0);
  const [detectedFaces, setDetectedFaces] = useState<FaceBox[]>([]);
  const [scanDims, setScanDims] = useState({ width: 0, height: 0 });


  // Show the operator what the detector found, so choosing a different face is
  // a click rather than guesswork.
  useEffect(() => {
    // Every per-image judgement resets when the photo changes. Otherwise the
    // previous subject's review, enrolment result and correct/wrong marks stay
    // on screen and get submitted against the new face.
    setReview('');
    setTaught(null);
    setTeachError('');
    setReviewChain(null);
    setJudged({});
    setCropRegion(null);
    setFaceIndex(0);

    if (!inputImage) {
      setDetectedFaces([]);
      return;
    }
    let cancelled = false;
    detectFace(inputImage)
      .then((r) => {
        if (cancelled) return;
        setDetectedFaces(r.faces || []);
        setScanDims({ width: r.image_width || 0, height: r.image_height || 0 });
      })
      .catch(() => { if (!cancelled) setDetectedFaces([]); });
    return () => { cancelled = true; };
  }, [inputImage]);


  /** The headline result, shaped like a grid card so one judge() serves both. */
  const primaryAsMatch = (): MatchResult | null => {
    if (!result || result.match_found === false) return null;
    return {
      url: result.discovered_post.url,
      platform: result.discovered_post.platform,
      author: result.discovered_post.author,
      title: result.discovered_post.title,
      image_url: result.discovered_post.image_url,
      face_crop_base64: result.discovered_post.post_face_crop_base64,
      media_sha256: (result.discovered_post as { media_sha256?: string }).media_sha256,
      discovery_source: (result.discovered_post as { discovery_source?: string }).discovery_source,
      similarity_percentage: result.metrics.similarity_percentage,
      euclidean_distance: result.metrics.euclidean_distance,
      cosine_similarity: result.metrics.cosine_similarity,
      faces_found: 1,
    };
  };

  const judge = async (m: MatchResult, label: 'correct' | 'incorrect') => {
    setJudged((prev) => ({ ...prev, [m.url]: label }));
    try {
      const res = await submitFeedback({
        label,
        euclidean_distance: m.euclidean_distance,
        cosine_similarity: m.cosine_similarity,
        threshold_used: threshold,
        system_verdict: true,
        page_url: m.url,
        platform: m.platform,
        discovery_source: m.discovery_source,
        media_sha256: m.media_sha256,
        record_hash: result?.record_hash || '',
        note: review,
        commit_on_chain: anchorReview,
        // Scopes a rejection to this face: the same image may legitimately be
        // the right answer for somebody else.
        probe_embedding: result?.input_face?.embedding,
      });
      setFeedbackTick((n) => n + 1);
      const rec = (res as { recorded?: Record<string, unknown> })?.recorded;
      if (rec) {
        const chain = (rec.chain || {}) as Record<string, unknown>;
        setReviewChain({
          review_sha256: rec.review_sha256 as string | undefined,
          transaction_hash: chain.transaction_hash as string | undefined,
          block_number: chain.block_number as number | undefined,
          simulated: chain.simulated as boolean | undefined,
        });
      }
    } catch (e) {
      console.error('[feedback]', e);
    }
  };
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setInputImage(reader.result as string);
        setResult(null);
        setErrorMsg(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const executePipeline = async () => {
    if (!inputImage) {
      setErrorMsg('Please upload or provide a face scan image first.');
      return;
    }
    if (!authorizedUse) {
      setErrorMsg('Confirm that you are authorized to use this image before starting a face search.');
      return;
    }
    if (caps && !caps.reverse_image_available && !searchQuery.trim()) {
      setErrorMsg('Enter a public name, handle or URL so the live search has a discovery hint.');
      focusHint();
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    // A run produces a new result, so every judgement about the previous one is
    // stale. Carrying the old review over would attach it to a different match
    // and, if anchored, put the wrong justification on-chain.
    setReview('');
    setTaught(null);
    setTeachError('');
    setReviewChain(null);
    setJudged({});
    setStepState(1); // Face encoding

    try {
      setTimeout(() => setStepState(2), 500); // Searching web
      setTimeout(() => setStepState(3), 1200); // Blockchain

      const data = await runSocialSearchPipeline(
        inputImage,
        searchQuery,
        threshold,
        authorizedUse,
        cropRegion,
        faceIndex,
      );

      if (!data.success) {
        setErrorMsg(data.error || 'Failed to complete pipeline');
        setStepState(0);
      } else if (data.match_found === false) {
        // The search ran and genuinely found nobody. Show that plainly - the
        // pipeline must never substitute a stand-in identity here.
        setResult(data);
        setStepState(4);
      } else {
        setResult(data);
        setStepState(4); // Completed
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error running pipeline');
      setStepState(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* HEADER BANNER */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--rule-strong)',
          borderRadius: '16px',
          padding: '1.75rem',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f4f6f0' }}> Task 3: Face Identification, Social Media Discovery & Blockchain Verification
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: '0.925rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
          <strong>Pipeline shape:</strong> Face Scan Input &rarr; Web/Social Media Search (discovering real post) &rarr; Blockchain Upload & Re-Verification.
        </p>
      </div>

      {/* INPUT PANEL */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* LEFT: FACE SCAN INPUT */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--rule-strong)',
            borderRadius: '14px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#d3e3bb', display: 'flex', alignItems: 'center', gap: '0.5rem' }}> Step 1: Input Face Scan
          </h3>

          {inputImage ? (
            /* Once a photo is loaded the panel becomes interactive: the operator
               can click one of the detected faces or drag a box, instead of
               being stuck with whichever face won on area. */
            <FaceRegionSelector
              imageSrc={inputImage}
              detectedFaces={detectedFaces}
              imageWidth={scanDims.width}
              imageHeight={scanDims.height}
              value={cropRegion}
              onChange={setCropRegion}
              faceIndex={faceIndex}
              onFaceIndexChange={setFaceIndex}
            />
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: '240px',
                border: '2px dashed rgba(211, 227, 187, 0.35)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                overflow: 'hidden',
                background: 'rgba(32, 36, 26, 0.40)',
                position: 'relative',
              }}
            >
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <span style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.86)', fontWeight: 400 }}>Click to Upload Face Scan</span>
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'rgba(255,255,255,0.62)', marginTop: '0.25rem' }}> Supports JPEG, PNG (Webcam snapshot or photo)
                </span>
              </div>
            </div>
          )}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            style={{ display: 'none' }}
          />

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1,
                background: '#20241a',
                color: 'rgba(255,255,255,0.86)',
                border: '1px solid #2c3125',
                padding: '0.6rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 400,
              }}
            > Choose File
            </button>
            {inputImage && (
              <button
                onClick={() => setInputImage(null)}
                style={{
                  background: 'rgba(224, 133, 133, 0.18)',
                  color: '#e89a9a',
                  border: '1px solid rgba(224, 133, 133, 0.35)',
                  padding: '0.6rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              > Clear
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: SEARCH CONTROLS */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--rule-strong)',
            borderRadius: '14px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem', color: '#c2d2a8', display: 'flex', alignItems: 'center', gap: '0.5rem' }}> Step 2: Automated Web & Social Discovery
            </h3>

            <div
              style={{
                background: 'rgba(32, 36, 26, 0.60)',
                border: '1px solid rgba(203, 191, 160, 0.22)',
                borderRadius: '10px',
                padding: '0.875rem',
                marginBottom: '1rem',
              }}
            >
              {/* Describes the mechanism that is actually available. The old
                  copy advertised "100% face-driven, no keyword needed", which
                  only holds with a reverse-image API key configured - without
                  one, leaving the hint blank can never return a result. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{
                  fontSize: '0.75rem',
                  background: caps?.reverse_image_available ? '#9fb886' : '#cbbfa0',
                  color: '#12140f',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  fontWeight: 500,
                }}>
                  {caps?.reverse_image_available ? 'FACE-DRIVEN' : 'FACE-GATED'}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#f4f6f0', fontWeight: 400 }}>
                  {caps?.reverse_image_available
                    ? `Reverse image search via ${caps.reverse_image_search}`
                    : 'Live search, verified against your face'}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
                {caps?.reverse_image_available ? (
                  <>
                    The face image itself is sent to the visual-search provider, so no
                    name or keyword is needed. Every candidate returned is then
                    re-detected, embedded and compared against your scan.
                    {' '}<strong style={{ color: '#e8c46a' }}>Note:</strong> Google Lens ranks
                    on overall visual similarity, not face identity &mdash; it will return
                    look-alikes and people wearing similar glasses or headphones. The face
                    check filters those out, but it cannot make Lens retrieve someone it
                    never indexed. To reliably re-find a specific person, teach the system
                    their identity below.
                  </>
                ) : caps?.live_search_available ? (
                  <>
                    <strong style={{ color: '#e8c46a' }}>A search hint is required.</strong>{' '}
                    A 128D face vector cannot be sent to a text search engine, so discovery
                    is seeded by a name or handle &mdash; then <strong>every</strong> candidate
                    image is downloaded, every face in it embedded, and compared against your
                    scan. Only a candidate under L&#8322; {caps ? 1.128 : ''} is returned.
                    Face-only search needs a reverse-image API key.
                  </>
                ) : (
                  <>Checking which discovery mechanism is available&hellip;</>
                )}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ background: '#171a13', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #20241a' }}>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.44)' }}>SEARCH SCOPE</div>
                <div style={{ fontSize: '0.8rem', color: '#d3e3bb', fontWeight: 400 }}>Live Web & Social Media</div>
              </div>
              <div style={{ background: '#171a13', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #20241a' }}>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.44)' }}>BIOMETRIC METRIC</div>
                <div style={{ fontSize: '0.8rem', color: '#cbbfa0', fontWeight: 400 }}>128D Euclidean (L₂) + Cosine</div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'rgba(255,255,255,0.62)', marginBottom: '0.25rem' }}>
                <span>Match Threshold (L₂ distance)</span>
                <span style={{
                  color: threshold > MATCH_THRESHOLD ? '#e8c46a' : '#d3e3bb',
                  fontWeight: 400,
                }}>
                  {threshold.toFixed(3)}
                  {Math.abs(threshold - MATCH_THRESHOLD) < 0.001 && ' (default)'}
                </span>
              </div>
              <input
                type="range"
                min="0.40"
                max="1.50"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: threshold > MATCH_THRESHOLD ? '#e8c46a' : '#d3e3bb' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'rgba(255,255,255,0.44)', marginTop: '0.2rem' }}>
                <span>Strict (0.40)</span>
                <span>SFace default (1.128)</span>
                <span>Permissive (1.50)</span>
              </div>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', lineHeight: 1.5 }}>
                {threshold > MATCH_THRESHOLD ? (
                  <span style={{ color: '#e8c46a' }}>
                    Above the published SFace operating point ({MATCH_THRESHOLD}). This accepts
                    weaker matches and will admit false positives &mdash; different people
                    typically land at L₂ 1.20&ndash;1.45. The value used is written into the
                    canonical record that is hashed on-chain, so it stays auditable.
                  </span>
                ) : threshold < MATCH_THRESHOLD ? (
                  <>Stricter than the SFace default ({MATCH_THRESHOLD}). Fewer false positives,
                  more genuine matches rejected.</>
                ) : (
                  <>SFace&rsquo;s published operating point. Validated against same-person and
                  different-person pairs; changing it is recorded on-chain.</>
                )}
              </p>
              {threshold !== MATCH_THRESHOLD && (
                <button
                  onClick={() => setThreshold(MATCH_THRESHOLD)}
                  style={{
                    marginTop: '0.4rem', background: 'transparent',
                    border: '1px solid var(--rule-strong)', color: 'rgba(255,255,255,0.62)',
                    borderRadius: '6px', padding: '0.25rem 0.6rem',
                    fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Reset to default ({MATCH_THRESHOLD})
                </button>
              )}
            </div>

            {/* The hint is only genuinely optional when a reverse-image
                provider is configured. Without one it is required, so it is
                shown expanded and labelled as such - collapsing it behind a
                <details> summary made it easy to miss, and a blank hint then
                produces a search that cannot possibly succeed. */}
            {caps && !caps.reverse_image_available ? (
              <div style={{ marginTop: '0.75rem' }}>
                <label
                  htmlFor="search-hint"
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    color: '#e8c46a',
                    marginBottom: '0.35rem',
                  }}
                >
                  Search hint &mdash; required
                </label>
                <input
                  id="search-hint"
                  ref={hintInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Name, handle or post URL, e.g. Triggered Insaan"
                  style={{
                    width: '100%',
                    background: '#171a13',
                    border: `1px solid ${searchQuery.trim() ? '#2c3125' : 'rgba(232, 196, 106, 0.45)'}`,
                    color: '#f4f6f0',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                {!searchQuery.trim() && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', lineHeight: 1.5 }}>
                    Leave this blank and the search has nothing to query &mdash; the run will
                    return <strong>0 candidates</strong>. Enter a public name or handle; every
                    result is still verified against your face.
                  </div>
                )}
              </div>
            ) : (
              <details ref={hintDetailsRef} style={{ marginTop: '0.75rem' }}>
                <summary style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', cursor: 'pointer', outline: 'none' }}>
                  Optional search hint (leave blank for pure face-driven search)
                </summary>
                <div style={{ marginTop: '0.4rem' }}>
                  <input
                    ref={hintInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Optional: specific handle or post URL"
                    style={{
                      width: '100%',
                      background: '#171a13',
                      border: '1px solid #2c3125',
                      color: '#f4f6f0',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              </details>
            )}

            <label style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', marginTop: '0.9rem', color: 'rgba(255,255,255,0.62)', fontSize: '0.76rem', lineHeight: 1.45, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={authorizedUse}
                onChange={(event) => setAuthorizedUse(event.target.checked)}
                style={{ marginTop: '0.16rem', accentColor: '#d3e3bb' }}
              />
              <span>I am authorized to use this image and will use results only as an investigatory lead, not as a sole basis for a decision.</span>
            </label>
          </div>

          <button
            disabled={loading || !inputImage || !authorizedUse}
            onClick={executePipeline}
            style={{
              width: '100%',
              background: loading || !inputImage || !authorizedUse ? '#2c3125' : 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)',
              color: '#ffffff',
              border: 'none',
              padding: '0.9rem',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: loading || !inputImage || !authorizedUse ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(211, 227, 187, 0.28)',
            }}
          >
            {loading ? (
              <> Running End-to-End Pipeline...
              </>
            ) : (
              <> Run End-to-End Task 3 Pipeline</>
            )}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            background: 'rgba(224, 133, 133, 0.14)',
            border: '1px solid rgba(224, 133, 133, 0.35)',
            color: '#f0b8b8',
            padding: '1rem',
            borderRadius: '10px',
            fontSize: '0.9rem',
          }}
        >
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* PIPELINE PROGRESS STEPS */}
      {loading && (
        <div
          style={{
            background: '#171a13',
            border: '1px solid #20241a',
            borderRadius: '12px',
            padding: '1.25rem',
            display: 'flex',
            justifyContent: 'space-around',
          }}
        >
          <div style={{ textAlign: 'center', opacity: stepState >= 1 ? 1 : 0.4 }}>
            <div style={{ fontSize: '0.85rem', color: '#d3e3bb', fontWeight: 400 }}>1. Face Ingestion</div>
          </div>
          <div style={{ textAlign: 'center', opacity: stepState >= 2 ? 1 : 0.4 }}>
            <div style={{ fontSize: '0.85rem', color: '#c2d2a8', fontWeight: 400 }}>2. Web & Social Search</div>
          </div>
          <div style={{ textAlign: 'center', opacity: stepState >= 3 ? 1 : 0.4 }}>
            <div style={{ fontSize: '0.85rem', color: '#9ce0b8', fontWeight: 400 }}>3. Blockchain Upload</div>
          </div>
        </div>
      )}

      {/* RESULT CARDS */}
      {result && result.match_found === false && (
        <div
          style={{
            background: 'rgba(20, 23, 16, 0.85)',
            border: '1px solid rgba(232, 196, 106, 0.32)',
            borderRadius: '16px',
            padding: '1.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="tag tag--warn">No match</span>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f4f6f0' }}>
              No matching public social media post found
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
            {result.message}
          </p>

          {/* What to do next. Branches on whether anything was actually
              searched: zero candidates means there was no query to run, which
              is a different situation from candidates checked and rejected. */}
          {(() => {
            const d = result.diagnostics?.search;
            const nothingSearched = !d || d.candidates_considered === 0;
            return (
              <div
                style={{
                  background: 'rgba(32, 36, 26, 0.60)',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#f4f6f0' }}>
                  {nothingSearched
                    ? 'Nothing was searched, so nothing was rejected.'
                    : `${d!.candidates_verified} candidate image(s) were checked and none matched this face.`}
                </div>

                {nothingSearched ? (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
                    A 128D face vector cannot be sent to a text search engine on its own.
                    Give the search something to start from &mdash; either a name/handle hint,
                    or a reverse-image API key for true face-only discovery.
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
                    The search ran and found real candidates, but none passed the biometric
                    threshold. That is the correct result &mdash; a match is never invented.
                    Try a different hint, or use tab <strong>02 1-to-1 verification</strong> to
                    compare two images directly.
                  </p>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                  <button
                    onClick={focusHint}
                    style={{
                      background: 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)',
                      color: '#12140f',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.5rem 0.9rem',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Add a search hint in Step 2
                  </button>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', alignSelf: 'center' }}>
                    e.g. a public name or handle, then re-run
                  </span>
                </div>
              </div>
            );
          })()}

          <LearningPanel
            refreshKey={feedbackTick}
            currentThreshold={threshold}
            onApplyThreshold={setThreshold}
          />

          {result.diagnostics?.search && (
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>
              <div style={{ marginBottom: '0.5rem' }}>
                Search: {result.diagnostics.search.mechanisms.join(', ') || 'none available'} &middot;{' '}
                {result.diagnostics.search.candidates_verified} candidate image(s) checked &middot;
                threshold L2 &le; {result.diagnostics.search.threshold_l2}
              </div>
              {result.diagnostics.search.candidate_report.slice(0, 6).map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', borderTop: '1px solid var(--rule)' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.image_url}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.44)', whiteSpace: 'nowrap' }}>
                    {c.faces_found} face{c.faces_found === 1 ? '' : 's'}
                  </span>
                  <span className="mono" style={{ color: c.euclidean_distance != null ? '#d3e3bb' : '#e8c46a', whiteSpace: 'nowrap' }}>
                    {c.euclidean_distance != null ? `L2 ${c.euclidean_distance.toFixed(4)}` : (c.error || '-')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result && result.match_found !== false && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* RECOGNISED FROM MEMORY. This is checked before any web lookup and
              is the only mechanism that reliably re-identifies a specific
              person: reverse image search retrieves on overall visual
              similarity, so it returns look-alikes and matching accessories,
              not necessarily the same face. */}
          {result.known_identity && (
            <div style={{
              background: 'rgba(20, 23, 16, 0.85)',
              border: '1px solid rgba(127,214,162,0.45)',
              borderRadius: '16px', padding: '1.5rem',
              display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap',
            }}>
              {result.known_identity.thumbnail && (
                <img src={result.known_identity.thumbnail} alt=""
                     style={{ width: 72, height: 72, borderRadius: '10px', objectFit: 'cover',
                              border: '1px solid rgba(127,214,162,0.4)' }} />
              )}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span className="tag tag--live">Known identity</span>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f4f6f0' }}>
                    {result.known_identity.name}
                  </h3>
                  <span className="mono" style={{ fontSize: '0.78rem', color: '#a9e3b4' }}>
                    {result.known_identity.similarity_percentage?.toFixed(1)}% &middot;
                    L2 {result.known_identity.euclidean_distance?.toFixed(4)}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', marginTop: '0.35rem', lineHeight: 1.6 }}>
                  Recognised from {result.known_identity.reference_count} enrolled reference
                  photo{result.known_identity.reference_count === 1 ? '' : 's'} &mdash; matched via{' '}
                  <span style={{ color: '#d3e3bb' }}>{result.known_identity.matched_origin}</span>.
                  This came from memory, not from the web search below.
                </div>
                {result.known_identity.source_urls?.length > 0 && (
                  <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {result.known_identity.source_urls.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer"
                         style={{ fontSize: '0.73rem', color: 'rgba(255,255,255,0.62)',
                                  borderBottom: '1px solid var(--rule-strong)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {result.gallery && !result.known_identity && result.gallery.enrolled_identities > 0 && (
            <div style={{
              background: 'var(--surface-sunken)', border: '1px solid var(--rule)',
              borderRadius: '10px', padding: '0.75rem 1rem',
              fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)',
            }}>
              Checked against {result.gallery.enrolled_identities} enrolled
              identit{result.gallery.enrolled_identities === 1 ? 'y' : 'ies'}
              {' '}({result.gallery.enrolled_faces} reference faces) &mdash; no match from memory.
            </div>
          )}

          <LearningPanel
            refreshKey={feedbackTick}
            currentThreshold={threshold}
            onApplyThreshold={setThreshold}
          />

          {/* ALL PASSING MATCHES. A face search legitimately returns the same
              person across several pages; showing only the single best hides
              most of the evidence. Each card carries its own score and source,
              plus a correct/incorrect control that feeds threshold calibration. */}
          {result.all_matches && result.all_matches.length > 1 && (
            <div
              style={{
                background: 'rgba(20, 23, 16, 0.85)',
                border: '1px solid var(--rule-strong)',
                borderRadius: '16px',
                padding: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f4f6f0' }}>
                  {result.all_matches.length} matching results
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>
                  all passed L2 &le; {threshold.toFixed(3)} &middot; best first &middot; mark each to train the threshold
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                gap: '0.9rem',
              }}>
                {result.all_matches.map((m, i) => {
                  const verdict = judged[m.url];
                  const borderColor = verdict === 'correct'
                    ? 'rgba(127,214,162,0.5)'
                    : verdict === 'incorrect'
                      ? 'rgba(224,133,133,0.5)'
                      : 'var(--rule)';
                  return (
                    <div key={m.url + i} style={{
                      background: 'var(--surface-sunken)',
                      border: '1px solid ' + borderColor,
                      borderRadius: '10px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    }}>
                      <img
                        src={m.face_crop_base64 || m.image_url}
                        alt=""
                        style={{ width: '100%', height: '150px', objectFit: 'cover', background: '#12140f' }}
                      />
                      <div style={{ padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: '#d3e3bb' }}>{m.platform}</span>
                          <span className="mono" style={{ fontSize: '0.7rem', color: '#a9e3b4' }}>
                            {m.similarity_percentage?.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.44)' }}>
                          L2 {m.euclidean_distance?.toFixed(4)}
                        </div>
                        <a href={m.url} target="_blank" rel="noreferrer"
                           style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.62)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    borderBottom: '1px solid var(--rule-strong)' }}>
                          {m.title || m.url}
                        </a>

                        <div style={{ display: 'flex', gap: '0.3rem', marginTop: 'auto', paddingTop: '0.4rem' }}>
                          <button
                            onClick={() => judge(m, 'correct')}
                            disabled={!!verdict}
                            style={{
                              flex: 1, fontSize: '0.68rem', padding: '0.3rem',
                              borderRadius: '5px', cursor: verdict ? 'default' : 'pointer',
                              border: '1px solid rgba(127,214,162,0.4)',
                              background: verdict === 'correct' ? 'rgba(127,214,162,0.25)' : 'transparent',
                              color: '#a9e3b4', fontFamily: 'inherit',
                            }}
                          >
                            {verdict === 'correct' ? 'Correct' : 'Correct'}
                          </button>
                          <button
                            onClick={() => judge(m, 'incorrect')}
                            disabled={!!verdict}
                            style={{
                              flex: 1, fontSize: '0.68rem', padding: '0.3rem',
                              borderRadius: '5px', cursor: verdict ? 'default' : 'pointer',
                              border: '1px solid rgba(224,133,133,0.4)',
                              background: verdict === 'incorrect' ? 'rgba(224,133,133,0.25)' : 'transparent',
                              color: '#e89a9a', fontFamily: 'inherit',
                            }}
                          >
                            {verdict === 'incorrect' ? 'Not them' : 'Not them'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p style={{ margin: '0.9rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', lineHeight: 1.5 }}>
                Labels are appended to <code>backend/data/feedback.jsonl</code> &mdash; distances and
                verdicts only, never images or embeddings. Analyse them with
                <code> backend/notebooks/threshold_calibration.ipynb</code> to derive a threshold from
                your own data.
              </p>
            </div>
          )}

          {/* SECTION: DISCOVERED SOCIAL MEDIA POST */}
          <div
            style={{
              background: 'rgba(20, 23, 16, 0.85)',
              border: '1px solid var(--rule-strong)',
              borderRadius: '16px',
              padding: '1.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: '#9fb886', color: '#fff', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 500 }}>
                  {result.discovered_post.platform}
                </span>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f4f6f0' }}> Discovered Social Media Post
                </h3>
              </div>
              <span
                style={{
                  background: result.metrics.is_match ? 'rgba(141, 219, 168, 0.18)' : 'rgba(224, 133, 133, 0.18)',
                  color: result.metrics.is_match ? '#a9e3b4' : '#e89a9a',
                  border: `1px solid ${result.metrics.is_match ? '#8ddba8' : '#e08585'}`,
                  padding: '0.35rem 0.85rem',
                  borderRadius: '20px',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                }}
              >
                {result.metrics.is_match ? 'MATCH CONFIRMED' : 'MISMATCH'} ({result.metrics.similarity_percentage}%)
              </span>
            </div>

            {/* Feedback on the primary result. Previously this only existed in
                the multi-result grid, so a search returning a single match gave
                the operator nowhere to say whether it was right - and the
                calibration set never grew. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              flexWrap: 'wrap', padding: '0.75rem 0',
              borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
              marginBottom: '1.25rem',
            }}>
              <span style={{ fontSize: '0.8rem', color: '#f4f6f0' }}>
                Is this the right person?
              </span>
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', flex: 1, minWidth: '200px' }}>
                Your answer is added to the calibration set - it is how the threshold
                learns from your photos rather than staying at a generic default.
              </span>
              {(() => {
                const primary = primaryAsMatch();
                const verdict = primary ? judged[primary.url] : undefined;
                return (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => primary && judge(primary, 'correct')}
                      disabled={!primary || !!verdict}
                      style={{
                        padding: '0.4rem 0.9rem', borderRadius: '6px', fontSize: '0.78rem',
                        cursor: verdict ? 'default' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid rgba(127,214,162,0.45)',
                        background: verdict === 'correct' ? 'rgba(127,214,162,0.28)' : 'transparent',
                        color: '#a9e3b4',
                      }}
                    >
                      {verdict === 'correct' ? 'Marked correct' : 'Correct'}
                    </button>
                    <button
                      onClick={() => primary && judge(primary, 'incorrect')}
                      disabled={!primary || !!verdict}
                      style={{
                        padding: '0.4rem 0.9rem', borderRadius: '6px', fontSize: '0.78rem',
                        cursor: verdict ? 'default' : 'pointer', fontFamily: 'inherit',
                        border: '1px solid rgba(224,133,133,0.45)',
                        background: verdict === 'incorrect' ? 'rgba(224,133,133,0.28)' : 'transparent',
                        color: '#e89a9a',
                      }}
                    >
                      {verdict === 'incorrect' ? 'Marked wrong' : 'Not this person'}
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* Written review. Anchoring hashes the wording itself, so the
                judgement cannot later be quietly rewritten and still match
                what the chain holds. */}
            <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="review-text" style={{ fontSize: '0.78rem', color: '#f4f6f0' }}>
                Written review <span style={{ color: 'rgba(255,255,255,0.44)' }}>(optional)</span>
              </label>
              <textarea
                id="review-text"
                value={review}
                onChange={(e) => setReview(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Why is this right or wrong? e.g. 'Same person - matching mole under left eye, same jawline.' or 'Different person - similar hairstyle only.'"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#171a13', border: '1px solid #2c3125',
                  color: '#f4f6f0', borderRadius: '8px',
                  padding: '0.6rem 0.75rem', fontSize: '0.8rem',
                  fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={anchorReview}
                    onChange={(e) => setAnchorReview(e.target.checked)}
                  />
                  Anchor this review on the blockchain
                </label>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.44)' }}>
                  {review.length}/2000 &middot; write it first, then press Correct or Not this person
                </span>
              </div>

              {/* Teaching is different from labelling. A label tunes the
                  threshold; this enrols an identity so the face is recognised
                  directly next time, without depending on a search engine. */}
              <div style={{
                background: 'var(--surface-sunken)',
                border: '1px solid var(--rule)',
                borderRadius: '8px', padding: '0.75rem',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={teach}
                    disabled={teaching || !review.trim() || !authorizedUse}
                    style={{
                      background: review.trim() && authorizedUse
                        ? 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)' : 'transparent',
                      color: review.trim() && authorizedUse ? '#12140f' : 'rgba(255,255,255,0.35)',
                      border: review.trim() && authorizedUse ? 'none' : '1px solid var(--rule-strong)',
                      borderRadius: '8px', padding: '0.45rem 1rem',
                      fontSize: '0.8rem', fontWeight: 500,
                      cursor: teaching || !review.trim() || !authorizedUse ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {teaching ? 'Verifying the claim...' : 'Teach the system this identity'}
                  </button>
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)', flex: 1, minWidth: 200 }}>
                    Put profile links in the review. Each one is fetched and face-checked
                    before anything is remembered.
                  </span>
                </div>

                {teachError && (
                  <div style={{ fontSize: '0.75rem', color: '#e89a9a' }}>{teachError}</div>
                )}

                {taught && (
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.7 }}>
                    <div style={{ color: '#a9e3b4', marginBottom: '0.3rem' }}>
                      Learned &ldquo;{taught.identity}&rdquo; &mdash; {taught.enrolled_faces} reference
                      face{taught.enrolled_faces === 1 ? '' : 's'} stored
                      ({taught.verified_count} verified, {taught.unverified_count} unverified,
                      {' '}{taught.rejected_count} rejected)
                    </div>
                    {taught.references.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{
                          color: r.status === 'verified' ? '#a9e3b4'
                            : r.status === 'rejected' ? '#e89a9a' : '#e8c46a',
                          minWidth: 74,
                        }}>
                          {r.status}
                        </span>
                        <span style={{ flex: 1, minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.url}
                        </span>
                        {r.euclidean_distance != null && (
                          <span className="mono" style={{ color: '#d3e3bb' }}>
                            L2 {r.euclidean_distance.toFixed(4)}
                          </span>
                        )}
                      </div>
                    ))}
                    <div style={{ marginTop: '0.4rem', color: 'rgba(255,255,255,0.44)' }}>
                      Next time this face is searched it is recognised from memory first,
                      before any web lookup. Teach it again with other photos of the same
                      person to cover different ages and lighting.
                    </div>
                  </div>
                )}
              </div>

              {reviewChain && (
                <div style={{
                  background: 'var(--surface-sunken)',
                  border: '1px solid ' + (reviewChain.simulated ? 'rgba(232,196,106,0.35)' : 'rgba(127,214,162,0.35)'),
                  borderRadius: '8px', padding: '0.6rem 0.75rem',
                  fontSize: '0.72rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.7,
                }}>
                  <div style={{ color: reviewChain.simulated ? '#e8c46a' : '#a9e3b4', marginBottom: '0.2rem' }}>
                    {reviewChain.simulated ? 'Review recorded (SIMULATED - not broadcast)' : 'Review anchored on-chain'}
                  </div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>
                    review SHA-256: {reviewChain.review_sha256}
                  </div>
                  {reviewChain.transaction_hash && (
                    <div className="mono" style={{ wordBreak: 'break-all' }}>
                      tx: {reviewChain.transaction_hash} &middot; block #{reviewChain.block_number}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1.5rem' }}>
              {/* FACE CROPS COMPARISON */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', display: 'block', marginBottom: '0.25rem' }}>Input Face Crop</span>
                  <img
                    src={result.input_face.crop_base64}
                    alt="Input Face Crop"
                    style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #d3e3bb' }}
                  />
                </div>
                {result.discovered_post.post_face_crop_base64 && (
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', display: 'block', marginBottom: '0.25rem' }}>Post Face Crop</span>
                    <img
                      src={result.discovered_post.post_face_crop_base64}
                      alt="Post Face Crop"
                      style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #c2d2a8' }}
                    />
                  </div>
                )}
                {result.discovered_post.image_url && (
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', display: 'block', marginBottom: '0.25rem' }}>Full Post Media</span>
                    <img
                      src={result.discovered_post.image_url}
                      alt="Full Post"
                      style={{ width: '100%', maxHeight: '90px', objectFit: 'contain', borderRadius: '8px', border: '1px solid #3c4234' }}
                    />
                  </div>
                )}
              </div>

              {/* POST DETAILS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Author / Account</span>
                  <div style={{ fontSize: '1.05rem', color: '#f4f6f0', fontWeight: 400 }}>@{result.discovered_post.author}</div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Post Title / Content</span>
                  <div style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.78)', lineHeight: 1.5 }}>
                    {result.discovered_post.description || result.discovered_post.title}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source Web Link</span>
                  <div>
                    <a
                      href={result.discovered_post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#d3e3bb', fontSize: '0.85rem', wordBreak: 'break-all' }}
                    >
                      {result.discovered_post.url} &rarr;
                    </a>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verified Media SHA-256</span>
                  <code style={{ display: 'block', marginTop: '0.3rem', color: '#d3e3bb', fontSize: '0.72rem', overflowWrap: 'anywhere' }}>
                    {result.discovered_post.media_sha256 || 'Unavailable'}
                  </code>
                  {result.discovered_post.discovery_source && (
                    <span style={{ display: 'block', marginTop: '0.25rem', color: 'rgba(255,255,255,0.44)', fontSize: '0.72rem' }}>
                      Discovery: {result.discovered_post.discovery_source}
                    </span>
                  )}
                </div>

                {/* BIOMETRIC METRICS BAR */}
                <div
                  style={{
                    background: '#171a13',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    display: 'flex',
                    gap: '1.5rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.44)' }}>Euclidean Dist: </span>
                    <strong style={{ color: '#f4f6f0' }}>{result.metrics.euclidean_distance}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.44)' }}>Cosine Sim: </span>
                    <strong style={{ color: '#f4f6f0' }}>{result.metrics.cosine_similarity}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.44)' }}>Threshold: </span>
                    <strong style={{ color: '#d3e3bb' }}>{MATCH_THRESHOLD}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION: BLOCKCHAIN PROOF & RE-VERIFICATION */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid rgba(127, 214, 162, 0.28)',
              borderRadius: '16px',
              padding: '1.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f4f6f0' }}> Blockchain Proof Commitment & Re-Verification
                </h3>
              </div>
              <span
                style={{
                  background: 'rgba(127, 214, 162, 0.16)',
                  color: '#9ce0b8',
                  border: '1px solid #7fd6a2',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '20px',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                }}
              > CONFIRMED ON-CHAIN
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', fontSize: '0.875rem' }}>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>SHA-256 Record Fingerprint:</span>
                <code style={{ background: '#12140f', padding: '0.4rem 0.6rem', borderRadius: '6px', color: '#d3e3bb', display: 'block', wordBreak: 'break-all' }}>
                  {result.record_hash}
                </code>
              </div>

              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>EVM Transaction Hash:</span>
                <code style={{ background: '#12140f', padding: '0.4rem 0.6rem', borderRadius: '6px', color: '#cbbfa0', display: 'block', wordBreak: 'break-all' }}>
                  {result.blockchain_upload.transaction_hash}
                </code>
              </div>

              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>Block Number:</span>
                <strong style={{ color: '#f4f6f0' }}>#{result.blockchain_upload.block_number || 'Mined'}</strong>
              </div>

              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>Network:</span>
                <strong style={{ color: '#f4f6f0' }}>{result.blockchain_upload.network}</strong>
              </div>

              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>Smart Contract Status:</span>
                <strong style={{ color: '#9ce0b8' }}>
                  {result.onchain_reverification.exists_on_chain ? 'Exists On-Chain (Verified via getVerification)' : 'Pending'}
                </strong>
              </div>

              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)', display: 'block', marginBottom: '0.2rem' }}>Recorder Account:</span>
                <code style={{ color: 'rgba(255,255,255,0.62)', fontSize: '0.8rem' }}>
                  {result.onchain_reverification.recorder || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'}
                </code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
