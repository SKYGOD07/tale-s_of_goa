'use client';

import React, { useState } from 'react';
import { VerificationResponse } from '../services/api';

interface EmbeddingPanelProps {
  embedding: number[];
  embeddingDimension: number;
  recordHash: string;
  verificationResult: VerificationResponse | null;
}

export const EmbeddingPanel: React.FC<EmbeddingPanelProps> = ({
  embedding,
  embeddingDimension,
  recordHash,
  verificationResult,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  if (!embedding || embedding.length === 0) {
    return null;
  }

  const formattedVector = `[\n  ${embedding
    .slice(0, 16)
    .map((v) => (v >= 0 ? ` ${v.toFixed(4)}` : v.toFixed(4)))
    .join(', ')} ... (${embedding.length - 16} values omitted)\n]`;

  return (
    <div
      style={{
        background: 'rgba(20, 23, 16, 0.95)',
        border: '1px solid var(--rule-strong)',
        borderRadius: '12px',
        marginTop: '16px',
        overflow: 'hidden',
        fontFamily: 'monospace',
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'rgba(32, 36, 26, 0.80)',
          border: 'none',
          color: '#d3e3bb',
          textAlign: 'left',
          fontWeight: 500,
          fontSize: '0.875rem',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span> PIPELINE INSPECTOR — GRAYSCALE CONVERSION & 128D VECTOR</span>
        <span>{isOpen ? 'HIDE' : 'SHOW'}</span>
      </button>

      {isOpen && (
        <div style={{ padding: '16px', color: 'rgba(255,255,255,0.86)', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Pre-processing details */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: '0.75rem', marginBottom: '4px' }}>COMPUTER VISION PRE-PROCESSING:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ background: 'rgba(211, 227, 187, 0.12)', color: '#d3e3bb', padding: '2px 8px', borderRadius: '4px' }}> 1. Face Localization (Haar Cascade)
              </span>
              <span style={{ background: 'rgba(127, 214, 162, 0.14)', color: '#9ce0b8', padding: '2px 8px', borderRadius: '4px' }}> 2. Grayscale Conversion (cv2.COLOR_BGR2GRAY)
              </span>
              <span style={{ background: 'rgba(212, 175, 55, 0.15)', color: '#d4af37', padding: '2px 8px', borderRadius: '4px' }}> 3. Histogram Equalization (equalizeHist)
              </span>
              <span style={{ background: 'rgba(192, 169, 122, 0.14)', color: '#d9c9a4', padding: '2px 8px', borderRadius: '4px' }}> 4. 128x128 Padded Crop Matrix
              </span>
            </div>
          </div>

          <div>
            <span style={{ color: 'rgba(255,255,255,0.62)' }}>Vector Dimension: </span>
            <strong style={{ color: '#7fd6a2' }}>{embeddingDimension} Numerical Values</strong>
            {embeddingDimension === 128 ? (
              <span style={{ marginLeft: '8px', color: '#7fd6a2' }}>( Exact 128D Unit Sphere Match)</span>
            ) : (
              <span style={{ marginLeft: '8px', color: '#e08585' }}>( Invalid Dimension)</span>
            )}
          </div>

          <div>
            <div style={{ color: 'rgba(255,255,255,0.62)', marginBottom: '4px' }}>Normalized Face Embedding Vector:</div>
            <pre
              style={{
                background: '#12140f',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #20241a',
                color: '#d3e3bb',
                fontSize: '0.75rem',
                overflowX: 'auto',
                margin: 0,
              }}
            >
              {formattedVector}
            </pre>
          </div>

          {recordHash && (
            <div>
              <div style={{ color: 'rgba(255,255,255,0.62)', marginBottom: '4px' }}>Canonical Biometric SHA-256 Hash:</div>
              <div
                style={{
                  background: '#12140f',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #20241a',
                  color: '#e8c46a',
                  fontSize: '0.75rem',
                  wordBreak: 'break-all',
                }}
              >
                {recordHash}
              </div>
            </div>
          )}

          {verificationResult && (() => {
            /* A locally simulated proof was never broadcast, so it must not
               be presented in the same confirmed-green treatment as a real
               transaction. */
            const simulated = !!verificationResult.simulated;
            const tone = simulated ? '#e8c46a' : '#7fd6a2';
            return (
              <div
                style={{
                  background: simulated ? 'rgba(232, 196, 106, 0.08)' : 'rgba(127, 214, 162, 0.08)',
                  border: `1px solid ${tone}`,
                  padding: '12px',
                  borderRadius: '8px',
                }}
              >
                <div style={{ color: tone, fontWeight: 500, marginBottom: '6px', letterSpacing: '0.04em' }}>
                  {simulated
                    ? 'SIMULATED PROOF — NOT BROADCAST ON-CHAIN'
                    : 'BLOCKCHAIN VERIFICATION RECORD CONFIRMED'}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.75rem' }}>
                  <div>Network: <strong>{verificationResult.network}</strong></div>
                  <div>Status: <strong style={{ color: tone }}>{verificationResult.status}</strong></div>
                  <div> Tx Hash:{' '}
                    {verificationResult.explorer_url ? (
                      <a
                        href={verificationResult.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#d3e3bb', borderBottom: '1px solid rgba(211,227,187,0.4)' }}
                      >
                        <code>{verificationResult.transaction_hash}</code>
                      </a>
                    ) : (
                      <code style={{ color: '#d3e3bb' }}>{verificationResult.transaction_hash}</code>
                    )}
                  </div>
                  {verificationResult.block_number && (
                    <div>Block Number: {verificationResult.block_number}</div>
                  )}
                  {verificationResult.gas_used && (
                    <div>Gas Used: {verificationResult.gas_used.toLocaleString()}</div>
                  )}
                  <div>Timestamp: {verificationResult.timestamp}</div>
                  {simulated && verificationResult.error && (
                    <div style={{ marginTop: 6, color: '#e8c46a' }}>{verificationResult.error}</div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
