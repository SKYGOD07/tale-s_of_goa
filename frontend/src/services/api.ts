export interface FaceBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SamplePixel {
  coordinate: string;
  rgb: string;
  bgr: string;
  grayscale: number;
  hex: string;
}

export interface PixelStats {
  image_width: number;
  image_height: number;
  total_pixels: number;
  channels: number;
  total_bytes: number;
  face_crop_width?: number;
  face_crop_height?: number;
  face_crop_pixels?: number;
  standardized_grid_pixels: number;
  sample_pixels: SamplePixel[];
}

export interface DetectResponse {
  face_detected: boolean;
  face_count: number;
  faces: FaceBox[];
  status_message: string;
  image_width: number;
  image_height: number;
  pixel_stats?: PixelStats;
  rgb_crop_base64?: string;
  grayscale_crop_base64?: string;
  equalized_crop_base64?: string;
  error?: string;
}

export interface EncodeResponse {
  success: boolean;
  embedding_dimension: number;
  embedding: number[];
  record_hash: string;
  pixel_stats?: PixelStats;
  rgb_crop_base64?: string;
  grayscale_crop_base64?: string;
  equalized_crop_base64?: string;
  error?: string;
}

export interface VerificationResponse {
  success: boolean;
  record_hash: string;
  transaction_hash: string;
  network: string;
  status: string;
  timestamp: string;
  block_number?: number;
  /** True when the proof was generated locally and never broadcast. */
  simulated?: boolean;
  chain_id?: number;
  explorer_url?: string | null;
  gas_used?: number;
  error?: string;
}

export interface ChainStatus {
  chain_id: number;
  network: string;
  rpc_url: string;
  contract_address?: string | null;
  explorer_url?: string | null;
  /** Contract address and signing key are both present. */
  configured: boolean;
  /** The RPC endpoint answered. */
  connected: boolean;
  /** Connected, configured, and the signing account holds gas. */
  live: boolean;
  account?: string | null;
  balance_eth?: number | null;
  block_number?: number | null;
  message: string;
}

export interface CompareResponse {
  success: boolean;
  is_match: boolean;
  similarity_percentage: number;
  euclidean_distance: number;
  cosine_similarity: number;
  threshold_used: number;
  status_message: string;
  face_a_detected: boolean;
  face_b_detected: boolean;
  face_a_box?: FaceBox;
  face_b_box?: FaceBox;
  pixel_stats_a?: PixelStats;
  pixel_stats_b?: PixelStats;
  rgb_crop_a_base64?: string;
  grayscale_crop_a_base64?: string;
  equalized_crop_a_base64?: string;
  rgb_crop_b_base64?: string;
  grayscale_crop_b_base64?: string;
  equalized_crop_b_base64?: string;
  embedding_a: number[];
  embedding_b: number[];
  record_hash: string;
  canonical_record?: any;
  blockchain_result?: VerificationResponse;
  error?: string;
}

export interface VerificationQueryResponse {
  record_hash: string;
  exists_on_chain: boolean;
  timestamp?: number;
  timestamp_iso?: string;
  recorder?: string;
  network: string;
  chain_id?: number;
  simulated?: boolean;
  explorer_url?: string | null;
  error?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function detectFace(base64Image: string): Promise<DetectResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/face/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        face_detected: false,
        face_count: 0,
        faces: [],
        status_message: `DETECTION ERROR (${res.status})`,
        image_width: 640,
        image_height: 480,
        error: errText,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      face_detected: false,
      face_count: 0,
      faces: [],
      status_message: 'BACKEND OFFLINE (PORT 8000)',
      image_width: 640,
      image_height: 480,
      error: 'Cannot connect to FastAPI backend at http://localhost:8000. Start backend with: python run.py',
    };
  }
}

export async function encodeFace(base64Image: string): Promise<EncodeResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/face/encode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        success: false,
        embedding_dimension: 0,
        embedding: [],
        record_hash: '',
        error: `Face encoding error: ${errText}`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      embedding_dimension: 0,
      embedding: [],
      record_hash: '',
      error: 'Cannot connect to FastAPI backend at http://localhost:8000. Please start it using: python run.py in the backend directory.',
    };
  }
}

export async function compareFaces(
  imageA: string,
  imageB: string,
  threshold: number = 1.128,
  autoRecordOnChain: boolean = true
): Promise<CompareResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/face/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_a: imageA,
        image_b: imageB,
        threshold: threshold,
        auto_record_on_chain: autoRecordOnChain,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        success: false,
        is_match: false,
        similarity_percentage: 0,
        euclidean_distance: 2.0,
        cosine_similarity: 0,
        threshold_used: threshold,
        status_message: 'Comparison API Error',
        face_a_detected: false,
        face_b_detected: false,
        embedding_a: [],
        embedding_b: [],
        record_hash: '',
        error: `Server error: ${errText}`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      is_match: false,
      similarity_percentage: 0,
      euclidean_distance: 2.0,
      cosine_similarity: 0,
      threshold_used: threshold,
      status_message: 'BACKEND OFFLINE (PORT 8000)',
      face_a_detected: false,
      face_b_detected: false,
      embedding_a: [],
      embedding_b: [],
      record_hash: '',
      error: 'Cannot connect to FastAPI backend at http://localhost:8000. Please start the backend with: python run.py in the backend folder.',
    };
  }
}

export async function recordVerification(recordHash: string): Promise<VerificationResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/verification/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ record_hash: recordHash }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        success: false,
        record_hash: recordHash,
        transaction_hash: '',
        network: 'EVM Testnet',
        status: 'failed',
        timestamp: '',
        error: `Blockchain recording error: ${errText}`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      record_hash: recordHash,
      transaction_hash: '',
      network: 'EVM Testnet',
      status: 'failed',
      timestamp: '',
      error: 'Cannot connect to FastAPI backend at http://localhost:8000.',
    };
  }
}

export async function queryVerification(recordHash: string): Promise<VerificationQueryResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/verification/query/${encodeURIComponent(recordHash)}`, {
      method: 'GET',
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        record_hash: recordHash,
        exists_on_chain: false,
        network: 'EVM Testnet',
        error: `Query error: ${errText}`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      record_hash: recordHash,
      exists_on_chain: false,
      network: 'EVM Testnet',
      error: 'Cannot connect to FastAPI backend at http://localhost:8000.',
    };
  }
}

export interface DiscoveredPost {
  url: string;
  platform: string;
  author: string;
  title: string;
  description: string;
  image_url: string;
  /** SHA-256 of the exact public media bytes used for face verification. */
  media_sha256?: string;
  /** Live discovery mechanism that produced this candidate. */
  discovery_source?: string;
  post_face_crop_base64?: string;
}

export interface PipelineMetrics {
  similarity_percentage: number;
  euclidean_distance: number;
  cosine_similarity: number;
  is_match: boolean;
}

/** One candidate the search considered, with its real biometric score. */
export interface CandidateReport {
  page_url: string;
  image_url: string;
  title?: string;
  author?: string;
  platform?: string;
  source?: string;
  faces_found: number;
  cosine_similarity?: number | null;
  euclidean_distance?: number | null;
  similarity_percentage?: number | null;
  is_match: boolean;
  error?: string | null;
}

export interface SearchDiagnostics {
  mechanisms: string[];
  capabilities: {
    reverse_image_search?: string | null;
    reverse_image_available: boolean;
    live_search_available: boolean;
    live_search_engine?: string | null;
    mode: string;
  };
  candidates_considered: number;
  candidates_verified: number;
  threshold_l2?: number;
  candidate_report: CandidateReport[];
  /** What happened to each URL pasted into the search hint. */
  hint_report?: HintReportEntry[];
}

/**
 * One URL from the search hint and its fate. 'blocked' means the host
 * refuses anonymous requests, which is a fact about that site, not a
 * failure the operator can retry their way out of.
 */
export interface HintReportEntry {
  url: string;
  status: 'fetched' | 'blocked' | 'no_image' | 'error';
  detail: string;
}

/** Recomputes the fingerprint and compares it with what the chain holds. */
export interface TamperCheck {
  recomputed_hash: string;
  stored_hash: string;
  hashes_identical: boolean;
  found_on_chain: boolean;
  simulated: boolean;
  verdict: 'VERIFIED' | 'UNVERIFIED' | 'TAMPERED';
}

export interface SocialSearchPipelineResponse {
  success: boolean;
  /** False when the search genuinely found nothing. Not an error. */
  match_found?: boolean;
  message?: string;
  pipeline_stage: string;
  input_face: {
    crop_base64?: string;
    image_width: number;
    image_height: number;
    /** The searching face, so a rejection can be scoped to it. */
    embedding?: number[];
  };
  discovered_post: DiscoveredPost;
  metrics: PipelineMetrics;
  record_hash: string;
  canonical_record: any;
  blockchain_upload: VerificationResponse;
  onchain_reverification: VerificationQueryResponse;
  /** Recognised from the enrolled gallery, before any web search. */
  known_identity?: KnownIdentity | null;
  gallery?: {
    enrolled_identities: number;
    enrolled_faces: number;
    top_scores?: KnownIdentity[];
  };
  /** Every candidate that passed the threshold, best first. */
  all_matches?: MatchResult[];
  match_count?: number;
  tamper_check?: TamperCheck;
  diagnostics?: {
    input_scan?: Record<string, any>;
    search?: SearchDiagnostics;
  };
  error?: string;
}

export async function runSocialSearchPipeline(
  imageBase64: string,
  query: string = '',
  threshold: number = 1.128,
  authorizedUse: boolean = false,
  // Manual overrides for photos the detector frames differently from the
  // operator: point at one person, or pick a different detected face.
  cropRegion: { left: number; top: number; right: number; bottom: number } | null = null,
  faceIndex: number = 0,
): Promise<SocialSearchPipelineResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/social/search-and-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageBase64,
        query: query,
        threshold: threshold,
        authorized_use: authorizedUse,
        crop_region: cropRegion,
        face_index: faceIndex,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(errText || `Server error ${res.status}`);
    }

    const data = await res.json();
    if (data && data.match_found === false) {
      return {
        ...data,
        input_face: data.input_face ?? { image_width: 0, image_height: 0 },
        discovered_post: data.discovered_post ?? {
          url: '', platform: '', author: '', title: '', description: '', image_url: '',
        },
        metrics: data.metrics ?? {
          similarity_percentage: 0, euclidean_distance: 0, cosine_similarity: 0, is_match: false,
        },
        record_hash: data.record_hash ?? '',
      };
    }
    return data;
  } catch (err: any) {
    return {
      success: false,
      pipeline_stage: 'FAILED',
      input_face: { image_width: 0, image_height: 0 },
      discovered_post: {
        url: '',
        platform: '',
        author: '',
        title: '',
        description: '',
        image_url: '',
      },
      metrics: {
        similarity_percentage: 0,
        euclidean_distance: 2.0,
        cosine_similarity: 0,
        is_match: false,
      },
      record_hash: '',
      canonical_record: null,
      blockchain_upload: {
        success: false,
        record_hash: '',
        transaction_hash: '',
        network: 'EVM Local Hardhat Node',
        status: 'failed',
        timestamp: '',
      },
      onchain_reverification: {
        record_hash: '',
        exists_on_chain: false,
        network: 'EVM Local Hardhat Node',
      },
      error: err.message || 'Cannot connect to backend',
    };
  }
}

export async function fetchSocialPost(url: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/social/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to fetch social post');
  }
  return await res.json();
}


/**
 * Reads which chain the backend is pointed at and whether it can actually
 * broadcast. Drives the network badge in the masthead and the simulated-mode
 * notice, so the UI never presents a dry run as a confirmed on-chain proof.
 */
export async function getChainStatus(): Promise<ChainStatus> {
  const res = await fetch(`${API_BASE_URL}/api/verification/status`);
  if (!res.ok) {
    throw new Error(`Chain status unavailable (${res.status})`);
  }
  return await res.json();
}

export interface SearchCapabilities {
  reverse_image_search?: string | null;
  reverse_image_available: boolean;
  live_search_available: boolean;
  live_search_engine?: string | null;
  mode: 'reverse_image' | 'live_scripted' | 'unavailable';
}

export interface CapabilitiesResponse {
  models: Record<string, unknown>;
  search: SearchCapabilities;
}

/**
 * Which discovery mechanism is actually available right now. The UI must
 * describe what the backend can really do - promising "no keyword needed"
 * when no reverse-image provider is configured sends users down a path that
 * cannot succeed.
 */
export async function getSearchCapabilities(): Promise<CapabilitiesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/social/capabilities`);
  if (!res.ok) throw new Error(`Capabilities unavailable (${res.status})`);
  return await res.json();
}

/** An identity the system has been taught and now recognises directly. */
export interface KnownIdentity {
  name: string;
  source_urls: string[];
  reference_count: number;
  similarity_percentage: number;
  euclidean_distance: number;
  cosine_similarity: number;
  matched_origin: string;
  thumbnail?: string;
  is_match: boolean;
}

/** One candidate that passed the biometric gate. */
export interface MatchResult {
  url: string;
  platform: string;
  author: string;
  title: string;
  image_url: string;
  face_crop_base64?: string;
  media_sha256?: string;
  discovery_source?: string;
  similarity_percentage: number;
  euclidean_distance: number;
  cosine_similarity: number;
  faces_found: number;
}

export interface FeedbackPayload {
  label: 'correct' | 'incorrect' | 'unsure';
  euclidean_distance: number;
  cosine_similarity?: number;
  threshold_used?: number;
  system_verdict?: boolean;
  page_url?: string;
  platform?: string;
  discovery_source?: string;
  media_sha256?: string;
  record_hash?: string;
  /** Free-text justification, stored verbatim. */
  note?: string;
  /** Anchor this review's SHA-256 on the blockchain. */
  commit_on_chain?: boolean;
  /** The searching face, so a rejection applies only to it. */
  probe_embedding?: number[];
}

export interface FeedbackStats {
  stats: {
    total: number; correct: number; incorrect: number; unsure: number;
    agreement_rate: number | null; path: string;
  };
  calibration: {
    samples: number; same_person: number; different_person: number;
    suggested_threshold: number | null; balanced_accuracy: number | null;
    published_default: number; confident: boolean; message: string;
  };
}

/** Record whether a returned match was actually the right person. */
export async function submitFeedback(payload: FeedbackPayload) {
  const res = await fetch(`${API_BASE_URL}/api/social/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Feedback failed (${res.status})`);
  return await res.json();
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const res = await fetch(`${API_BASE_URL}/api/social/feedback/stats`);
  if (!res.ok) throw new Error(`Stats unavailable (${res.status})`);
  return await res.json();
}

export interface TeachReference {
  url: string;
  platform: string;
  status: 'verified' | 'unverified' | 'rejected' | 'skipped' | 'error';
  reason?: string;
  similarity_percentage?: number;
  euclidean_distance?: number;
  image_url?: string;
}

export interface TeachResult {
  /** How the identity got its name: stated by the operator, or matched. */
  name_source?: string;
  /** Other enrolled identities this same face also matches. */
  also_matches?: string[];
  success: boolean;
  identity: string;
  enrolled_faces: number;
  added_now: number;
  references: TeachReference[];
  verified_count: number;
  unverified_count: number;
  rejected_count: number;
  threshold_used: number;
}

/**
 * Teach the system an identity from a written review. Whatever the review
 * cites is fetched and face-checked against the photo before anything is
 * stored - a claim on its own is never enough.
 */
/**
 * FastAPI reports refusals as {"detail": "..."} - and those details are the
 * useful part here ("does not match any stored photo of X..."), so unwrap them
 * rather than surfacing a JSON blob to the operator.
 */
async function errorDetail(res: Response, fallback: string): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === 'string') return parsed.detail;
  } catch {
    /* not JSON - fall through to the raw text */
  }
  return body || fallback;
}

export async function teachIdentity(
  imageBase64: string,
  review: string,
  name: string = '',
  authorizedUse: boolean = false,
): Promise<TeachResult> {
  const res = await fetch(`${API_BASE_URL}/api/social/teach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64, review, name, authorized_use: authorizedUse,
    }),
  });
  if (!res.ok) {
    throw new Error(await errorDetail(res, `Teach failed (${res.status})`));
  }
  return await res.json();
}

/* ────────────────────────────────────────────────────────────────────
   Identity enrolment.

   The registration page and 1-to-1 verification both feed the same
   gallery the discovery pipeline checks first. Enrolling several photos
   of one person taken at different times is what makes an older photo
   keep matching: a probe is scored against the CLOSEST reference, not
   an average, so range helps rather than dilutes.

   Every image after the first is face-checked against the first by the
   backend. A photo that fails comes back in `rejected` with its score
   instead of being stored, because one mislabelled reference would make
   the identity wrong permanently.
   ──────────────────────────────────────────────────────────────────── */

export interface EnrollScore {
  euclidean_distance: number;
  cosine_similarity: number;
  similarity_percentage: number;
  note: string;
}

export interface EnrollRejection {
  index: number;
  reason: string;
  euclidean_distance?: number;
  cosine_similarity?: number;
}

export interface EnrollResult {
  success: boolean;
  identity: string;
  added_now: number;
  total_references: number;
  accepted: EnrollScore[];
  rejected: EnrollRejection[];
  threshold_used: number;
}

export async function enrollIdentity(
  images: string[],
  name: string,
  note: string = '',
  authorizedUse: boolean = false,
  threshold?: number,
): Promise<EnrollResult> {
  const res = await fetch(`${API_BASE_URL}/api/social/gallery/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images, name, note, authorized_use: authorizedUse,
      ...(threshold ? { threshold } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(await errorDetail(res, `Enrolment failed (${res.status})`));
  }
  return await res.json();
}
