'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaceBox } from '../services/api';

/**
 * Lets the operator point at which face to search with.
 *
 * The detector picks the largest face, which is usually right but not always:
 * in a group shot the wrong person can win on area, and a small or off-centre
 * subject loses to a bystander closer to the camera. Dragging a box here sends
 * `crop_region` to the backend, which then runs detection inside that box only.
 *
 * Coordinates are the whole problem. The <img> is laid out with
 * `object-fit: contain`, so it is uniformly scaled and letterboxed inside its
 * container. Screen pixels therefore map to original image pixels through one
 * scale factor plus a centring offset — the same geometry FaceOverlay uses.
 * Everything emitted upward is in ORIGINAL image coordinates so the backend and
 * any overlay agree.
 */

export interface CropRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Props {
  imageSrc: string;
  /** Faces the backend already found, in original image coordinates. */
  detectedFaces?: FaceBox[];
  imageWidth?: number;
  imageHeight?: number;
  value: CropRegion | null;
  onChange: (region: CropRegion | null) => void;
  /** Which auto-detected face is selected, when no manual box is drawn. */
  faceIndex?: number;
  onFaceIndexChange?: (index: number) => void;
}

interface Layout {
  scale: number;
  offsetX: number;
  offsetY: number;
  natW: number;
  natH: number;
}

export function FaceRegionSelector({
  imageSrc,
  detectedFaces = [],
  imageWidth,
  imageHeight,
  value,
  onChange,
  faceIndex = 0,
  onFaceIndexChange,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /** Recompute the contain-fit mapping between screen and image pixels. */
  const measure = useCallback(() => {
    const host = boxRef.current;
    const img = imgRef.current;
    if (!host || !img) return;

    const natW = img.naturalWidth || imageWidth || 0;
    const natH = img.naturalHeight || imageHeight || 0;
    if (!natW || !natH) return;

    const r = host.getBoundingClientRect();
    const scale = Math.min(r.width / natW, r.height / natH);
    setLayout({
      scale,
      offsetX: (r.width - natW * scale) / 2,
      offsetY: (r.height - natH * scale) / 2,
      natW,
      natH,
    });
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    measure();
    const host = boxRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [measure, imageSrc]);

  const toImage = (clientX: number, clientY: number) => {
    const host = boxRef.current;
    if (!host || !layout) return null;
    const r = host.getBoundingClientRect();
    const x = (clientX - r.left - layout.offsetX) / layout.scale;
    const y = (clientY - r.top - layout.offsetY) / layout.scale;
    return {
      x: Math.max(0, Math.min(layout.natW, x)),
      y: Math.max(0, Math.min(layout.natH, y)),
    };
  };

  const toScreen = (region: CropRegion) => {
    if (!layout) return null;
    return {
      left: region.left * layout.scale + layout.offsetX,
      top: region.top * layout.scale + layout.offsetY,
      width: (region.right - region.left) * layout.scale,
      height: (region.bottom - region.top) * layout.scale,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toImage(e.clientX, e.clientY);
    if (!p) return;
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const region: CropRegion = {
      left: Math.round(Math.min(drag.x0, drag.x1)),
      top: Math.round(Math.min(drag.y0, drag.y1)),
      right: Math.round(Math.max(drag.x0, drag.x1)),
      bottom: Math.round(Math.max(drag.y0, drag.y1)),
    };
    setDrag(null);
    // A stray click is not a selection. Anything under ~24px a side is almost
    // certainly accidental and would crop away the face entirely.
    if (region.right - region.left < 24 || region.bottom - region.top < 24) {
      onChange(null);
      return;
    }
    onChange(region);
  };

  const live = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        right: Math.max(drag.x0, drag.x1),
        bottom: Math.max(drag.y0, drag.y1),
      }
    : null;

  const shown = live || value;
  const shownScreen = shown ? toScreen(shown) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'relative',
          height: '260px',
          borderRadius: '10px',
          overflow: 'hidden',
          background: '#12140f',
          cursor: 'crosshair',
          touchAction: 'none',
          userSelect: 'none',
          border: '1px solid var(--rule-strong)',
        }}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Face scan"
          onLoad={measure}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />

        {/* Auto-detected faces. Click one to search with it instead of dragging. */}
        {!shown && layout && detectedFaces.map((f, i) => {
          const s = toScreen({ left: f.left, top: f.top, right: f.right, bottom: f.bottom });
          if (!s) return null;
          const active = i === faceIndex;
          return (
            <div
              key={i}
              onPointerDown={(e) => {
                e.stopPropagation();
                onFaceIndexChange?.(i);
              }}
              title={`Use face ${i + 1}`}
              style={{
                position: 'absolute',
                left: s.left, top: s.top, width: s.width, height: s.height,
                border: `2px solid ${active ? '#a9e3b4' : 'rgba(255,255,255,0.45)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                boxShadow: active ? '0 0 12px rgba(169,227,180,0.45)' : 'none',
              }}
            >
              <span style={{
                position: 'absolute', top: '-18px', left: 0,
                fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
                background: active ? '#a9e3b4' : 'rgba(0,0,0,0.65)',
                color: active ? '#12140f' : '#fff',
                fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}>
                face {i + 1}{active ? ' (using)' : ''}
              </span>
            </div>
          );
        })}

        {/* The manual selection */}
        {shownScreen && (
          <div style={{
            position: 'absolute',
            left: shownScreen.left, top: shownScreen.top,
            width: shownScreen.width, height: shownScreen.height,
            border: '2px solid #e8c46a',
            borderRadius: '4px',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.44)' }}>
          {shown
            ? `Searching inside ${Math.round(shown.right - shown.left)}x${Math.round(shown.bottom - shown.top)} px region`
            : detectedFaces.length > 1
              ? `${detectedFaces.length} faces found - click one, or drag a box`
              : 'Drag a box to choose which face to search with'}
        </span>
        {value && (
          <button
            onClick={() => onChange(null)}
            style={{
              background: 'transparent', border: '1px solid var(--rule-strong)',
              color: 'rgba(255,255,255,0.62)', borderRadius: '6px',
              padding: '0.2rem 0.55rem', fontSize: '0.7rem',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Clear region
          </button>
        )}
      </div>
    </div>
  );
}
