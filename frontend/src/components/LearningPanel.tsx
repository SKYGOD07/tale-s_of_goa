'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getFeedbackStats, FeedbackStats } from '../services/api';

/**
 * Shows what the system has learned from operator feedback.
 *
 * Honest scope, stated in the UI as well as here: this calibrates the DECISION
 * THRESHOLD from labelled distances. It does not retrain SFace - that needs
 * tens of thousands of labelled identities and a GPU. The threshold is the part
 * that genuinely adapts to your camera, lighting and photo quality, and
 * per-deployment it is the part that decides most of your errors.
 *
 * The panel refreshes whenever `refreshKey` changes, so submitting a label
 * updates it immediately.
 */

interface Props {
  refreshKey?: number;
  currentThreshold: number;
  onApplyThreshold?: (t: number) => void;
}

export function LearningPanel({ refreshKey = 0, currentThreshold, onApplyThreshold }: Props) {
  const [data, setData] = useState<FeedbackStats | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getFeedbackStats()
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (error || !data) return null;

  const { stats, calibration } = data;
  const labelled = stats.correct + stats.incorrect;

  // 10 of each class is the point below which one more label swings the
  // suggestion noticeably, so that is what the progress bar aims at.
  const TARGET = 10;
  const pctSame = Math.min(100, (calibration.same_person / TARGET) * 100);
  const pctDiff = Math.min(100, (calibration.different_person / TARGET) * 100);

  const bar = (label: string, n: number, pct: number, color: string) => (
    <div style={{ flex: 1, minWidth: 150 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 3 }}>
        <span style={{ color: 'rgba(255,255,255,0.62)' }}>{label}</span>
        <span className="mono" style={{ color }}>{n} / {TARGET}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .4s ease' }} />
      </div>
    </div>
  );

  return (
    <div
      style={{
        background: 'rgba(20, 23, 16, 0.85)',
        border: '1px solid var(--rule-strong)',
        borderRadius: '16px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f4f6f0' }}>Learning from your feedback</h3>
        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.44)' }}>
          {labelled === 0
            ? 'no labels yet - mark a result correct or wrong to start'
            : `${labelled} label${labelled === 1 ? '' : 's'} collected`}
        </span>
      </div>

      {/* Progress toward a trustworthy sample */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {bar('Same-person labels', calibration.same_person, pctSame, '#a9e3b4')}
        {bar('Different-person labels', calibration.different_person, pctDiff, '#e89a9a')}
      </div>

      {/* Headline numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
        <Stat label="Agreement with you"
              value={stats.agreement_rate === null ? '—' : `${(stats.agreement_rate * 100).toFixed(0)}%`}
              tone={stats.agreement_rate === null ? undefined
                : stats.agreement_rate >= 0.8 ? '#a9e3b4' : '#e8c46a'} />
        <Stat label="Threshold in use" value={currentThreshold.toFixed(3)} mono />
        <Stat label="Suggested by your data"
              value={calibration.suggested_threshold?.toFixed(3) ?? '—'}
              tone={calibration.suggested_threshold ? '#d3e3bb' : undefined} mono />
        <Stat label="Balanced accuracy"
              value={calibration.balanced_accuracy?.toFixed(3) ?? '—'} mono />
      </div>

      <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
        {calibration.message}
      </p>

      {calibration.suggested_threshold !== null &&
       Math.abs(calibration.suggested_threshold - currentThreshold) > 0.005 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onApplyThreshold?.(calibration.suggested_threshold as number)}
            style={{
              background: calibration.confident ? 'linear-gradient(135deg, #8fa877 0%, #6f8a55 100%)' : 'transparent',
              color: calibration.confident ? '#12140f' : '#e8c46a',
              border: calibration.confident ? 'none' : '1px solid rgba(232,196,106,0.45)',
              borderRadius: '8px', padding: '0.45rem 0.9rem',
              fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Apply {calibration.suggested_threshold.toFixed(3)}
          </button>
          {!calibration.confident && (
            <span style={{ fontSize: '0.72rem', color: '#e8c46a' }}>
              Small sample &mdash; keep labelling before trusting this.
            </span>
          )}
        </div>
      )}

      <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.44)', lineHeight: 1.6 }}>
        This tunes the <strong>decision threshold</strong> to your photos, camera and
        lighting. It does not retrain the face model &mdash; that needs tens of thousands
        of labelled identities and a GPU. Labels are stored as distances and verdicts
        only, never images or embeddings. Full analysis in{' '}
        <code>backend/notebooks/threshold_calibration.ipynb</code>.
      </p>
    </div>
  );
}

function Stat({ label, value, tone, mono }: {
  label: string; value: string; tone?: string; mono?: boolean;
}) {
  return (
    <div style={{
      background: 'var(--surface-sunken)',
      border: '1px solid var(--rule)',
      borderRadius: '8px',
      padding: '0.5rem 0.7rem',
    }}>
      <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.44)' }}>{label}</div>
      <div className={mono ? 'mono' : undefined}
           style={{ fontSize: '0.95rem', color: tone || '#f4f6f0', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
