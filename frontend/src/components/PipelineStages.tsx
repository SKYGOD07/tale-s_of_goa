'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * The three Task 3 stages, animated while they run.
 *
 * The old indicator dimmed inactive labels to 40% opacity and nothing else,
 * so a run that took twenty seconds looked identical to one that had hung.
 * This shows three things a waiting operator actually needs:
 *
 *   - which stage is running now, and which have finished
 *   - that the process is still alive (a breathing ring, not a spinner per
 *     stage, so a row of three does not look frantic)
 *   - how long it has been running, because "is it stuck?" is the real
 *     question and only elapsed time answers it
 *
 * The bar is deliberately NOT a percentage. Reverse image search has no
 * measurable progress, and a fake percentage that stalls at 90% is worse
 * than an honest indeterminate sweep.
 */

export interface Stage {
  label: string;
  detail: string;
}

const STAGES: Stage[] = [
  { label: 'Face ingestion', detail: 'Detect, align, embed' },
  { label: 'Web & social search', detail: 'Retrieve, then face-check each candidate' },
  { label: 'Blockchain commit', detail: 'Hash, submit, read back' },
];

interface Props {
  /** 0 = not started, 1-3 = that stage is running, 4 = all done. */
  step: number;
  running: boolean;
}

export function PipelineStages({ step, running }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) { startedAt.current = null; setElapsed(0); return; }
    startedAt.current = Date.now();
    // One second is enough resolution for a progress read-out, and it keeps
    // this off the animation frame budget the 3D scene is already using.
    const id = window.setInterval(() => {
      if (startedAt.current) setElapsed((Date.now() - startedAt.current) / 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <div
      className="glass glass--quiet enter"
      style={{ padding: '1.15rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="eyebrow">Pipeline</span>
        <span style={{ flex: 1 }} />
        {running && (
          <span
            className="mono"
            style={{ fontSize: 'var(--t-micro)', color: 'var(--ink-faint)' }}
          >
            {elapsed.toFixed(0)}s elapsed
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
        }}
      >
        {STAGES.map((s, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n && running;
          const tone = done ? 'var(--live)' : active ? 'var(--leaf)' : 'var(--ink-ghost)';

          return (
            <div
              key={s.label}
              style={{
                display: 'flex',
                gap: 11,
                alignItems: 'flex-start',
                opacity: done || active ? 1 : 0.45,
                transition: 'opacity var(--dur-slow) var(--ease-out)',
              }}
            >
              <span
                className={active ? 'pulse-ring' : undefined}
                style={{
                  width: 22,
                  height: 22,
                  flex: 'none',
                  borderRadius: '50%',
                  border: `1px solid ${tone}`,
                  color: tone,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 'var(--t-micro)',
                  fontFamily: 'var(--mono)',
                  background: done ? 'var(--live-soft)' : 'transparent',
                  transition: 'border-color var(--dur-base) var(--ease), background var(--dur-base) var(--ease)',
                }}
              >
                {done ? '✓' : n}
              </span>

              <div style={{ minWidth: 0 }}>
                <div
                  className={done || active ? 'settle' : undefined}
                  key={`${s.label}-${done}-${active}`}
                  style={{ fontSize: 'var(--t-small)', color: done || active ? 'var(--ink-strong)' : 'var(--ink-faint)' }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 'var(--t-micro)', color: 'var(--ink-ghost)', marginTop: 2 }}>
                  {active ? s.detail : done ? 'done' : s.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="progress-track" aria-hidden>
        <div
          className={running ? 'progress-fill progress-fill--indeterminate' : 'progress-fill'}
          style={{ width: `${Math.min(100, (Math.max(0, step - 1) / STAGES.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}
