'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The opening sequence, and the page that explains what this thing is.
 *
 * Three reasons it works the way it does:
 *
 *  - It is a **cover, not a gate**. The app mounts and starts fetching
 *    underneath; dismissing the overlay reveals work already done rather
 *    than starting it. Nothing here delays first paint of the real UI.
 *  - It is shown **once per browser** and then reachable from the header.
 *    An intro that reappears on every reload stops being an introduction
 *    and becomes an obstacle.
 *  - Every animation is transform/opacity only. This app already runs a 3D
 *    scene, so the overlay must not add layout or paint work on top of it.
 *
 * `Escape` closes it, focus is trapped while it is open, and the whole
 * sequence collapses to a plain fade when the operator prefers reduced
 * motion.
 */

const SEEN_KEY = 'tog.intro.seen.v1';

interface Props {
  /** Force it open (from the header button) regardless of the stored flag. */
  open?: boolean;
  onClose?: () => void;
}

interface Panel {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}

const PANELS: Panel[] = [
  {
    eyebrow: 'What this is',
    title: 'A face, a real post, a permanent receipt',
    body: (
      <>
        <p>
          Tales of Goa runs one pipeline end to end: a face scan goes in, a genuinely
          matching public post is found on the web, and the result is committed to an
          Ethereum smart contract so it cannot be quietly altered afterwards.
        </p>
        <p>
          Nothing in the answer is invented. If no post matches the face, the pipeline
          says so and stops &mdash; a no-match is a correct outcome, not a failure.
        </p>
      </>
    ),
  },
  {
    eyebrow: 'How it decides',
    title: 'YuNet, then SFace, then the chain',
    body: (
      <>
        <p>
          <strong>Detect</strong> &mdash; YuNet returns the face box and five landmarks.
          <br />
          <strong>Align</strong> &mdash; the face is warped onto those landmarks, so the
          eyes land in a fixed position before anything is measured.
          <br />
          <strong>Embed</strong> &mdash; SFace encodes it as a 128-dimensional vector.
          <br />
          <strong>Commit</strong> &mdash; the canonical record is hashed with SHA-256 and
          only the 32-byte hash goes on-chain.
        </p>
        <p>
          Two faces are the same person when their L&#8322; distance falls under the
          threshold &mdash; 1.128 by default, which is SFace&rsquo;s published operating
          point. You can move it, and the value used is recorded in the hash.
        </p>
      </>
    ),
  },
  {
    eyebrow: 'How to run it',
    title: 'Three tabs, or the terminal',
    body: (
      <>
        <p>
          <strong>01 Automated discovery</strong> &mdash; drop in a photo, tick the
          authorisation box, run the pipeline.
          <br />
          <strong>02 1-to-1 verification</strong> &mdash; compare two images directly, and
          enrol the pair once you have confirmed it.
          <br />
          <strong>03 Registration &amp; proof</strong> &mdash; capture one face, name it,
          and anchor the proof.
        </p>
        <p className="mono" style={{ fontSize: 'var(--t-micro)', color: 'var(--leaf)' }}>
          python run_pipeline.py --image face.jpg
          <br />
          python verify_chain.py status | commit | query
        </p>
      </>
    ),
  },
  {
    eyebrow: 'Before you start',
    title: 'It produces leads, not verdicts',
    body: (
      <>
        <p>
          Reverse image search ranks on overall visual similarity, not on identity. It
          returns look-alikes and people wearing similar glasses; the biometric check
          filters those out, but it cannot retrieve someone the index never saw.
        </p>
        <p>
          Treat every match as an investigatory lead to be confirmed by a person &mdash;
          never as the sole basis for a decision about someone.
        </p>
      </>
    ),
  },
];

export function IntroExperience({ open, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panel, setPanel] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  // First visit only. Reading localStorage can throw in a locked-down
  // browser, so a failure just means the intro does not auto-open.
  useEffect(() => {
    if (open) { setVisible(true); return; }
    try {
      if (!localStorage.getItem(SEEN_KEY)) setVisible(true);
    } catch {
      /* storage unavailable - stay closed */
    }
  }, [open]);

  const close = useCallback(() => {
    setClosing(true);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    // Let the exit animation finish before unmounting. 320ms matches
    // --dur-base plus a frame; reduced-motion users skip it via CSS.
    window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
      setPanel(0);
      restoreFocus.current?.focus?.();
      onClose?.();
    }, 320);
  }, [onClose]);

  // Escape to leave, arrows to move, and focus kept inside while open.
  useEffect(() => {
    if (!visible) return;
    restoreFocus.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowRight') setPanel((p) => Math.min(PANELS.length - 1, p + 1));
      if (e.key === 'ArrowLeft') setPanel((p) => Math.max(0, p - 1));
      if (e.key === 'Tab' && dialogRef.current) {
        const items = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-screen cover is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [visible, close]);

  if (!visible) return null;

  const last = panel === PANELS.length - 1;
  const p = PANELS[panel];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Introduction to Tales of Goa"
      ref={dialogRef}
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: '4vmin',
        background: 'rgba(8, 10, 7, 0.72)',
        backdropFilter: 'blur(22px) saturate(140%)',
        WebkitBackdropFilter: 'blur(22px) saturate(140%)',
        animation: closing
          ? 'fadeIn var(--dur-base) var(--ease) reverse forwards'
          : 'fadeIn var(--dur-slow) var(--ease-out) both',
        outline: 'none',
      }}
    >
      <div
        className="glass glass--strong glass--sweep"
        style={{
          width: 'min(780px, 100%)',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 'clamp(24px, 4vw, 44px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          animation: closing
            ? 'scaleIn var(--dur-base) var(--ease) reverse forwards'
            : 'blurIn var(--dur-enter) var(--ease-spring) both',
        }}
      >
        {/* ── Wordmark ─────────────────────────────────────────────── */}
        <div className="enter-blur" style={{ animationDelay: '80ms' }}>
          <div
            className="eyebrow"
            style={{ color: 'var(--gold)', letterSpacing: '0.22em' }}
          >
            HH Goa 2026 &middot; Task 03
          </div>
          <h1
            style={{
              fontSize: 'var(--t-display)',
              fontWeight: 200,
              lineHeight: 1.05,
              marginTop: 10,
              letterSpacing: '-0.02em',
            }}
          >
            Tales of Goa
          </h1>
          <div
            aria-hidden
            style={{
              height: 1,
              marginTop: 18,
              background:
                'linear-gradient(90deg, transparent, var(--gold-rule) 18%, var(--rule-strong) 60%, transparent)',
              transformOrigin: 'left',
              animation: 'ruleDraw var(--dur-slow) var(--ease-out) 260ms both',
            }}
          />
        </div>

        {/* ── Panel body. Keyed so each change replays the entrance. ── */}
        <div key={panel} style={{ minHeight: 208 }}>
          <div className="eyebrow enter-left" style={{ animationDelay: '40ms' }}>
            {p.eyebrow}
          </div>
          <h2
            className="enter"
            style={{
              fontSize: 'var(--t-title)',
              fontWeight: 300,
              marginTop: 8,
              animationDelay: '90ms',
            }}
          >
            {p.title}
          </h2>
          <div
            className="enter-fade"
            style={{
              marginTop: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              color: 'var(--ink-soft)',
              fontSize: 'var(--t-small)',
              lineHeight: 1.75,
              animationDelay: '170ms',
            }}
          >
            {p.body}
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            borderTop: '1px solid var(--rule)',
            paddingTop: 18,
          }}
        >
          <div style={{ display: 'flex', gap: 7 }} aria-hidden>
            {PANELS.map((_, i) => (
              <button
                key={i}
                onClick={() => setPanel(i)}
                aria-label={`Go to panel ${i + 1}`}
                style={{
                  width: i === panel ? 22 : 7,
                  height: 7,
                  padding: 0,
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  background: i === panel ? 'var(--gold)' : 'var(--rule-bright)',
                  transition: 'width var(--dur-base) var(--ease-spring), background var(--dur-base) var(--ease)',
                }}
              />
            ))}
          </div>

          <span style={{ flex: 1 }} />

          <button className="pill press" onClick={close} style={pillStyle}>
            Skip
          </button>

          {!last ? (
            <button
              className="press"
              onClick={() => setPanel((n) => n + 1)}
              style={primaryStyle}
            >
              Next
            </button>
          ) : (
            <button className="press" onClick={close} style={primaryStyle}>
              Start
            </button>
          )}
        </div>

        <p style={{ fontSize: 'var(--t-micro)', color: 'var(--ink-ghost)' }}>
          Esc to close &middot; arrow keys to move &middot; reopen any time from the header
        </p>
      </div>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rule-strong)',
  borderRadius: 999,
  color: 'var(--ink-faint)',
  padding: '0.5rem 1.05rem',
  fontSize: 'var(--t-small)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const primaryStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)',
  border: 'none',
  borderRadius: 999,
  color: '#12140f',
  padding: '0.5rem 1.5rem',
  fontSize: 'var(--t-small)',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: '0 8px 22px -12px rgba(143, 168, 119, 0.9)',
};
