'use client';

import React from 'react';

interface CaptureButtonProps {
  onCapture: () => void;
  disabled: boolean;
  isProcessing: boolean;
  faceCount: number;
}

export const CaptureButton: React.FC<CaptureButtonProps> = ({
  onCapture,
  disabled,
  isProcessing,
  faceCount,
}) => {
  const getButtonText = () => {
    if (isProcessing) return 'PROCESSING BIOMETRIC PIPELINE...';
    if (faceCount === 0) return 'NO FACE IN FRAME';
    if (faceCount > 1) return 'KEEP ONLY 1 FACE IN FRAME';
    return 'CAPTURE FACE & GENERATE ON-CHAIN ID';
  };

  return (
    <button
      onClick={onCapture}
      disabled={disabled || isProcessing || faceCount !== 1}
      style={{
        width: '100%',
        padding: '16px 24px',
        fontSize: '1rem',
        fontWeight: 500,
        fontFamily: 'monospace',
        letterSpacing: '0.05em',
        borderRadius: '12px',
        border: 'none',
        background:
          disabled || faceCount !== 1
            ? 'var(--surface-sunken)'
            : 'linear-gradient(135deg, #8fa877 0%, #5f8f72 100%)',
        color: disabled || faceCount !== 1 ? 'rgba(255,255,255,0.62)' : '#ffffff',
        cursor: disabled || faceCount !== 1 || isProcessing ? 'not-allowed' : 'pointer',
        boxShadow:
          disabled || faceCount !== 1
            ? 'none'
            : '0 4px 20px rgba(143, 168, 119, 0.38)',
        transition: 'all 0.2s ease',
        marginTop: '16px',
      }}
    >
      {getButtonText()}
    </button>
  );
};
