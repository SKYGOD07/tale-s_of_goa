'use client';

import React, { useState } from 'react';
import { PixelStats } from '../services/api';

interface Props {
  title?: string;
  pixelStats?: PixelStats;
  rgbCropBase64?: string;
  grayscaleCropBase64?: string;
  equalizedCropBase64?: string;
  accentColor?: string;
}

export const PixelInspectionPanel: React.FC<Props> = ({
  title = 'Image Processing & Pixel Matrix Inspection',
  pixelStats,
  rgbCropBase64,
  grayscaleCropBase64,
  equalizedCropBase64,
  accentColor = '#d3e3bb',
}) => {
  const [activeTab, setActiveTab] = useState<'transforms' | 'pixels' | 'code'>('transforms');

  return (
    <div
      style={{
        background: '#14170f',
        border: `1px solid ${accentColor}33`,
        borderRadius: '16px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* Header & Sub-Tabs */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        paddingBottom: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h4 style={{ margin: 0, fontSize: '1rem', color: '#f4f6f0' }}>
            {title}
          </h4>
        </div>

        {/* View Switcher */}
        <div style={{
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '2px',
          display: 'flex',
          gap: '2px',
        }}>
          <button
            onClick={() => setActiveTab('transforms')}
            style={{
              background: activeTab === 'transforms' ? accentColor : 'transparent',
              color: activeTab === 'transforms' ? '#000000' : 'rgba(255,255,255,0.62)',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          > Grayscale & Transforms
          </button>

          <button
            onClick={() => setActiveTab('pixels')}
            style={{
              background: activeTab === 'pixels' ? accentColor : 'transparent',
              color: activeTab === 'pixels' ? '#000000' : 'rgba(255,255,255,0.62)',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          > RGB/BGR Pixel Data
          </button>

          <button
            onClick={() => setActiveTab('code')}
            style={{
              background: activeTab === 'code' ? accentColor : 'transparent',
              color: activeTab === 'code' ? '#000000' : 'rgba(255,255,255,0.62)',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          > OpenCV Code
          </button>
        </div>
      </div>

      {/* TAB 1: VISUAL TRANSFORMS (RGB Crop -> Grayscale -> Equalized Matrix) */}
      {activeTab === 'transforms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '14px',
          }}>

            {/* Step 1: RGB Crop */}
            <div style={{
              background: '#12140f',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#d3e3bb' }}>1. ORIGINAL RGB CROP</span>
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {rgbCropBase64 ? (
                  <img src={rgbCropBase64} alt="RGB Crop" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ color: '#3c4234', fontSize: '0.6875rem' }}>Waiting crop</span>
                )}
              </div>
              <span style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.44)' }}>RGB 3-Channel Color</span>
            </div>

            {/* Step 2: 8-bit Grayscale */}
            <div style={{
              background: '#12140f',
              border: '1px solid #9ce0b8',
              borderRadius: '10px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#9ce0b8' }}>2. 8-BIT GRAYSCALE</span>
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#000', border: '1px solid #9ce0b866', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {grayscaleCropBase64 ? (
                  <img src={grayscaleCropBase64} alt="Grayscale Crop" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ color: '#3c4234', fontSize: '0.6875rem' }}>Waiting crop</span>
                )}
              </div>
              <span style={{ fontSize: '0.625rem', color: '#c3ead4' }}>cv2.COLOR_BGR2GRAY</span>
            </div>

            {/* Step 3: Histogram Equalized */}
            <div style={{
              background: '#12140f',
              border: '1px solid #d4af37',
              borderRadius: '10px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#d4af37' }}>3. HIST EQUALIZED</span>
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#000', border: '1px solid #d4af3766', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {equalizedCropBase64 ? (
                  <img src={equalizedCropBase64} alt="Equalized Crop" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ color: '#3c4234', fontSize: '0.6875rem' }}>Waiting crop</span>
                )}
              </div>
              <span style={{ fontSize: '0.625rem', color: '#f0dc96' }}>cv2.equalizeHist()</span>
            </div>

            {/* Step 4: 128x128 Standardization */}
            <div style={{
              background: '#12140f',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              borderRadius: '10px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#d9c9a4' }}>4. 128D VECTOR</span>
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#000', border: '1px solid #c0a97a66', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <span style={{ fontSize: '1rem', color: '#d9c9a4' }}>128D</span>
                <span style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.62)' }}>Norm L2</span>
              </div>
              <span style={{ fontSize: '0.625rem', color: '#d9c9a4' }}>128x128 Grid Matrix</span>
            </div>

          </div>

          {/* Pixel Resolution Summary Banner */}
          {pixelStats && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '10px',
              fontSize: '0.75rem',
              background: 'rgba(0,0,0,0.3)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)' }}>Frame Resolution: </span>
                <strong style={{ color: '#f4f6f0' }}>{pixelStats.image_width} &times; {pixelStats.image_height}</strong>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)' }}>Total Image Pixels: </span>
                <strong style={{ color: '#d3e3bb' }}>{pixelStats.total_pixels.toLocaleString()} px</strong>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)' }}>Raw Byte Payload: </span>
                <strong style={{ color: '#c3ead4' }}>{(pixelStats.total_bytes / 1024).toFixed(1)} KB</strong>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.44)' }}>Face Crop Area: </span>
                <strong style={{ color: '#f0dc96' }}>
                  {pixelStats.face_crop_pixels ? `${pixelStats.face_crop_pixels.toLocaleString()} px` : 'N/A'}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PIXEL DATA MATRIX & COLOR CODES TABLE */}
      {activeTab === 'pixels' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.78)' }}> Discrete pixel RGB/BGR numerical values sampled directly from the face matrix:
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', fontFamily: 'monospace', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.62)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '8px 10px' }}>Coordinate</th>
                  <th style={{ padding: '8px 10px' }}>Color Swatch</th>
                  <th style={{ padding: '8px 10px' }}>RGB Code</th>
                  <th style={{ padding: '8px 10px' }}>BGR Code (OpenCV)</th>
                  <th style={{ padding: '8px 10px' }}>Hex Code</th>
                  <th style={{ padding: '8px 10px' }}>Grayscale (0-255)</th>
                </tr>
              </thead>
              <tbody>
                {pixelStats?.sample_pixels && pixelStats.sample_pixels.length > 0 ? (
                  pixelStats.sample_pixels.map((p, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '6px 10px', color: '#d3e3bb' }}>{p.coordinate}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '18px',
                          height: '18px',
                          borderRadius: '4px',
                          background: p.hex,
                          border: '1px solid rgba(255,255,255,0.3)',
                          verticalAlign: 'middle',
                        }} />
                      </td>
                      <td style={{ padding: '6px 10px', color: '#e89a9a' }}>{p.rgb}</td>
                      <td style={{ padding: '6px 10px', color: '#b3c79a' }}>{p.bgr}</td>
                      <td style={{ padding: '6px 10px', color: '#f0dc96' }}>{p.hex}</td>
                      <td style={{ padding: '6px 10px', color: '#9ce0b8' }}>{p.grayscale}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.44)' }}> Capture a frame or load an image to inspect live RGB/BGR pixel values.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.44)' }}>
             <em>Note: OpenCV uses BGR channel ordering by default. We convert incoming RGB frames using <code>cv2.COLOR_RGB2BGR</code> and compute 8-bit Grayscale as $Y = 0.299R + 0.587G + 0.114B$.</em>
          </div>
        </div>
      )}

      {/* TAB 3: OPENCV PYTHON PIPELINE CODE */}
      {activeTab === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.78)' }}> Python backend image transformation code executing in <code>app/services/face_processor.py</code>:
          </div>

          <pre style={{
            background: '#12140f',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            padding: '12px',
            color: '#d3e3bb',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            overflowX: 'auto',
            margin: 0,
            lineHeight: 1.5,
          }}>
{`# 1. Base64 Ingestion & RGB to BGR Color Space Conversion
image_bytes = base64.b64decode(base64_string)
image_rgb = Image.open(io.BytesIO(image_bytes)).convert('RGB')
image_bgr = cv2.cvtColor(np.array(image_rgb), cv2.COLOR_RGB2BGR)

# 2. Face Detection & Crop Extraction
boxes, width, height = detect_faces(image_bgr)
face_crop = crop_face_region(image_bgr, boxes[0], padding_pct=0.15)

# 3. 8-Bit Grayscale Conversion & Illumination Equalization
gray_face = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
equalized_face = cv2.equalizeHist(gray_face)

# 4. Standardized 128x128 Geometry Matrix & 128D Embedding Extraction
face_grid = cv2.resize(equalized_face, (128, 128))
embedding_128d = generate_128d_embedding(face_grid)
# Result: 128-dimensional unit-sphere normalized vector (shape: (128,))`}
          </pre>
        </div>
      )}

    </div>
  );
};
