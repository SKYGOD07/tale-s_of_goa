---
name: tales-of-goa-sylva-design-overhaul
description: "Overhaul the Tales of Goa (HH GOA 2026) face identification & blockchain verification site with Sylva Living Green's 3D atmosphere, Three.js renderer, liquid-metal animations, and premium visual design — while preserving every core pipeline component, biometric workflow, and blockchain verification flow."
---

# Tales of Goa — Sylva Design Overhaul

## Description

Integrate the complete Sylva Living Green 3D scene and its visual language as a full design overhaul for the Tales of Goa (HH GOA 2026) face identification & blockchain verification pipeline. The overhaul wraps the existing Next.js pipeline UI in a premium, immersive tropical environment powered by Three.js — the moss-root world, pale flowers, ferns, drifting pollen, the landing butterfly, and native liquid-metal controls — while every pipeline component (face detection, 128D embedding, social media search, EVM blockchain proof) remains fully functional and untouched.

This is a design layer enhancement, not a functional rewrite. The existing `page.tsx`, `SocialDiscoveryPipeline`, `FaceComparisonView`, `EmbeddingPanel`, `PixelInspectionPanel`, and all other pipeline components keep their logic. The overhaul targets:

- Full-page hero background using the Sylva living-green 3D scene
- Re-skinning the existing UI cards, panels, tabs, buttons, and badges to match the moss-root world's organic palette and liquid-metal control language
- Adding micro-animations, glassmorphism, and premium typography consistent with the Sylva design system
- Enhancing existing interactive elements (tab switcher, capture button, status indicators) with Sylva-grade hover effects and transitions

## Project context

- **Project**: Tales of Goa / HH GOA 2026 — Task #3 Face Identification & Blockchain Verification
- **Stack**: Next.js 16 + React 19 + TypeScript (frontend), FastAPI (backend), Hardhat EVM (blockchain)
- **Existing theme**: Dark navy/slate (`#0f172a`, `#020617`) with gold accents (`#d4af37`), Inter/system-ui
- **Brand identity**: 🌴 HH GOA branding, gold gradient headings, teal/blue pipeline accents
- **Pipeline**: Camera → OpenCV face detection → 128D embedding → Social media discovery → SHA-256 hash → EVM smart contract → On-chain re-verification

## Technologies

- React iframe host for the Sylva 3D scene (sandboxed full-document renderer)
- Byte-exact complete authored HTML document (`inner-green-3d.html`)
- Same-project local source URL served from Next.js `/public`
- Local Three.js runtime, local Lexend web font, two local card images, native liquid-metal controls
- Existing Next.js 16 app router structure preserved

## Verified source material

- `public/landing-pages/inner-green-3d.html` — Complete page with native controls
- `public/landing-pages/inner-green-assets/three.min.js` — Three.js runtime
- `public/landing-pages/inner-green-assets/lexend-latin.woff2` — Lexend web font
- `public/landing-pages/inner-green-assets/card-ecostove.jpg` — Card image asset
- `public/landing-pages/inner-green-assets/card-ethos.jpg` — Card image asset

Source revision: `SHA-256 05f359ce157a`

## Implementation steps

### Phase 1: Asset setup

1. Fetch and verify all source files from ThreeUI before any editing. If any source cannot be retrieved, stop and report rather than approximating.
2. Copy the complete Sylva HTML file byte-for-byte to `frontend/public/landing-pages/inner-green-3d.html`; do not extract, rewrite, shorten, or rebrand any section.
3. Copy all four asset files to `frontend/public/landing-pages/inner-green-assets/` at exactly those relative paths:
   - `three.min.js`
   - `lexend-latin.woff2`
   - `card-ecostove.jpg`
   - `card-ethos.jpg`
4. Verify every embedded style, script, media payload, interaction, responsive rule, and document-level lifecycle is preserved.

### Phase 2: Hero scene component

5. Create a `SylvaHeroBackground` React component that loads the local `inner-green-3d.html` in a full-size sandboxed iframe:
   - Full viewport coverage, positioned behind the pipeline UI (`position: fixed; z-index: 0`)
   - Iframe permissions retain authored scripts, same-origin resources, forms
   - Lazy-load only the React host bundle; do not import the HTML into the JS graph
   - Handle resize, reduced-motion, and WebGL context-loss gracefully

### Phase 3: UI design overhaul (preserve all pipeline logic)

6. **DO NOT modify** any pipeline component logic (`SocialDiscoveryPipeline`, `FaceComparisonView`, `CameraView`, `EmbeddingPanel`, `PixelInspectionPanel`, `DetectionStatus`, `CaptureButton`, `TestImageUpload`), API service layer, or state management.
7. **DO modify** the visual presentation layer of `page.tsx` and component styles:
   - Replace the flat dark gradient background with the Sylva 3D scene as a living background
   - Apply glassmorphism to all pipeline cards/panels: `backdrop-filter: blur(16px) saturate(1.2)`, translucent backgrounds with `rgba()` organic greens/dark moss tones
   - Re-skin the tab switcher with organic palette: moss greens, earth tones, gold accents (keep `#d4af37` for HH GOA brand elements)
   - Add micro-animations: fade-in on mount, subtle scale on hover for interactive cards, smooth transitions on tab switches
   - Apply Lexend or similar premium typography (available from the Sylva assets) for headings, with existing system-ui for body text
   - Enhance the status indicators, badges, and progress animations to feel organic and alive — pulsing glows, gentle breathing animations
   - Keep the existing 🌴 HH GOA logo, gold gradient, and "TASK #3 PIPELINE" badge — but refine their containers with glassmorphism
   - Style the backend health indicator with organic tones (green for online fits the nature theme)

### Phase 4: Animation enhancements to existing elements

8. Add Sylva-inspired animation enhancements to existing interactive elements:
   - Camera/upload toggle: liquid-metal slide transition
   - Capture button: organic pulse when face is detected, moss-glow hover state
   - Tab buttons: smooth gradient transition with slight scale-up on active
   - Pipeline step indicators: staggered fade-in animation as each step completes
   - Blockchain proof cards: frosted glass appearance with subtle border glow on confirmation
   - Embedding vector visualization: keep the existing display but add organic-themed container styling

### Phase 5: Responsive and accessibility

9. Verify desktop, tablet, and mobile layouts with the 3D background
10. Ensure the iframe scene does not block scroll or pointer events on the pipeline UI above it (`pointer-events: none` on the scene layer)
11. Respect `prefers-reduced-motion` — disable scene animations and micro-animations
12. Maintain all existing keyboard navigation and focus states

## Color palette mapping

| Purpose | Original | Overhaul |
|---------|----------|----------|
| Page background | `#020617` / `#0f172a` | Sylva 3D scene (living-green) with dark moss fallback `#0a1a0f` |
| Brand gold | `#d4af37` | Keep `#d4af37` — it's the HH GOA identity |
| Card backgrounds | `rgba(0,0,0,0.3)` | `rgba(10, 26, 15, 0.65)` with glass blur |
| Borders | `rgba(255,255,255,0.08)` | `rgba(180, 220, 180, 0.12)` organic green tint |
| Text primary | `#f8fafc` | `#f0f7f0` slightly green-tinted white |
| Text secondary | `#94a3b8` | `#8aab8a` moss-tinted grey |
| Active tab gradient | `#0ea5e9 → #6366f1` | `#2d6a3f → #1a4025` organic green gradient |
| Success/online | `#10b981` | Keep `#10b981` — already fits the nature theme |
| Error/offline | `#ef4444` | Keep `#ef4444` — universal signal color |
| Code accent | `#38bdf8` | `#4ade80` green-tinted code highlight |

## Local component pattern

```tsx
// SylvaHeroBackground.tsx — 3D scene background layer
"use client";
import React, { useRef, useEffect } from "react";

export function SylvaHeroBackground() {
  return (
    <iframe
      src="/landing-pages/inner-green-3d.html"
      title="Sylva Living Green 3D scene"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        zIndex: 0,
        pointerEvents: "none",
      }}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
      aria-hidden="true"
    />
  );
}
```

```tsx
// In page.tsx — layer the pipeline UI above the scene
import { SylvaHeroBackground } from "../components/SylvaHeroBackground";

// Inside the render:
<>
  <SylvaHeroBackground />
  <main style={{ position: "relative", zIndex: 1, ... }}>
    {/* All existing pipeline UI — unchanged logic */}
  </main>
</>
```

## Behavior contract

- **Runtime**: Full HTML + DOM/CSS + local Three.js (living-green variant)
- **Passes**: 1 sandboxed full-document renderer as background layer
- **Interaction**: 3D scene is visual-only background — all pointer/keyboard events pass through to pipeline UI
- **Assets**: Four local assets packaged at authored relative paths; the page makes no external network request
- **Pipeline integrity**: Every React component, API call, state management hook, tab routing, face detection flow, embedding visualization, blockchain recording, and on-chain verification flow remains exactly as authored
- **Branding**: 🌴 HH GOA logo, gold gradient headings, "TASK #3 PIPELINE" badge, and all pipeline-specific copy preserved verbatim
- **Design language**: Glassmorphism, organic green-moss palette, Lexend typography for headings, liquid-metal micro-animations on interactive elements

## Verification

1. All three tabs (Task 3 Pipeline, 1-to-1 Verification, Face ID Registration) render correctly with the new design
2. The Sylva 3D scene runs at native resolution behind the pipeline UI without blocking interaction
3. Camera/upload, face detection, embedding generation, social search, and blockchain proof flows work identically to before
4. FastAPI backend health check badge still functions (polling localhost:8000)
5. No external network requests from the Sylva scene (all assets local)
6. Responsive layout works on desktop and mobile
7. `prefers-reduced-motion` disables scene and micro-animations
8. Browser console shows no errors from the iframe scene or the pipeline components

## Guardrails

- Do not modify any pipeline component logic, API service layer, or state management
- Do not substitute a visually similar package, demo, shader, or runtime for the Sylva scene
- Do not approximate, reconstruct, or simplify the authored GLSL, render passes, geometry, interaction state, or assets
- Do not replace the HH GOA branding (gold gradient, palm emoji, task badges) with Sylva's own heading copy
- Do not remove any existing pipeline functionality to make room for the design overhaul
- Keep exact source and asset hashes under regression tests when the source project provides them
- The design overhaul is additive — it enhances the visual layer without touching the functional layer
