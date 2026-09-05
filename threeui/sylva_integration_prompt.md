# Tales of Goa — Sylva Living Green Design Overhaul

> **Project**: Tales of Goa / HH GOA 2026 — Task #3 Face Identification & Blockchain Verification  
> **Stack**: Next.js 16 + React 19 + TypeScript · FastAPI backend · Hardhat EVM blockchain  
> **Component**: `SylvaHero` · Variant: **Living Green** (`living-green`)  
> **Runtime**: Full HTML + DOM/CSS + local Three.js  
> **Source revision**: `SHA-256 05f359ce157a`

---

## Goal

Overhaul the entire visual design of the HH GOA pipeline site using the Sylva Living Green 3D scene and its visual language — the moss-root world with pale flowers, ferns, drifting pollen, the landing butterfly, and native liquid-metal controls — as a premium immersive backdrop and design system for the existing face identification & blockchain verification workflow.

> [!IMPORTANT]
> This is a **design-only overhaul**. Every pipeline component, API call, state management hook, tab routing, face detection flow, embedding visualization, blockchain recording, and on-chain verification flow must remain **exactly as authored**. Do not modify any functional logic.

---

## What to keep untouched

These files contain pipeline logic and **must not be functionally modified**:

| File | Role |
|------|------|
| `src/components/SocialDiscoveryPipeline.tsx` | Task 3 automated pipeline |
| `src/components/FaceComparisonView.tsx` | 1-to-1 verification & social matcher |
| `src/components/CameraView.tsx` | Webcam feed & face overlay |
| `src/components/EmbeddingPanel.tsx` | 128D vector display & hash |
| `src/components/PixelInspectionPanel.tsx` | Grayscale/equalized crop inspection |
| `src/components/DetectionStatus.tsx` | Pipeline status indicators |
| `src/components/CaptureButton.tsx` | Face capture trigger |
| `src/components/TestImageUpload.tsx` | Image upload handler |
| `src/services/api.ts` | FastAPI client |

Their **styling** (inline styles, CSS) may be enhanced, but their **React logic, state, props, event handlers, and API calls** must remain identical.

---

## Exact implementation source

Canonical HTML: [inner-green-3d.html](https://threeui.com/landing-pages/inner-green-3d.html)  
Complete registered source bundle: [sylva-hero.json](https://threeui.com/source-code/sylva-hero.json)

### Required registered files

- `public/landing-pages/inner-green-3d.html` — Complete page with 3D scene, native controls
- `public/landing-pages/inner-green-assets/three.min.js` — Three.js runtime
- `public/landing-pages/inner-green-assets/lexend-latin.woff2` — Lexend web font
- `public/landing-pages/inner-green-assets/card-ecostove.jpg` — Card image (290,988 bytes)
- `public/landing-pages/inner-green-assets/card-ethos.jpg` — Card image (316,720 bytes)

### SHA-256 verification hashes

| Path | MIME | Bytes | SHA-256 |
|------|------|------:|---------|
| `inner-green-assets/card-ecostove.jpg` | image/jpeg | 290988 | `70ce084084902bc502f00c366405b661ecdff90dee95d363b36a6e146829e433` |
| `inner-green-assets/card-ethos.jpg` | image/jpeg | 316720 | `337627390f499b3ae272cec9e2f83c817694a82f42e1aa10a7b26a2c7d679dff` |
| `inner-green-assets/lexend-latin.woff2` | font/woff2 | 39692 | `1ec8f6ee2750554b4bc59ff0b507d316a82a7ba37e0e5bebc41d3bd9b9faad46` |

---

## Implementation plan

### Phase 1 — Fetch & Stage Assets

1. **Fetch and read the complete source** from the ThreeUI canonical URL before editing. If the source cannot be retrieved, **stop and report** instead of recreating.
2. Copy `inner-green-3d.html` byte-for-byte to `frontend/public/landing-pages/inner-green-3d.html`.
3. Copy all four asset files to `frontend/public/landing-pages/inner-green-assets/` preserving exact relative paths.
4. Verify the document loads in isolation at `http://localhost:3000/landing-pages/inner-green-3d.html`.

### Phase 2 — Sylva Background Component

5. Create `frontend/src/components/SylvaHeroBackground.tsx`:

```tsx
"use client";
import React from "react";

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
        opacity: 0.85,
      }}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
      aria-hidden="true"
    />
  );
}
```

6. Integrate into `page.tsx` as the bottom layer:

```tsx
import { SylvaHeroBackground } from "../components/SylvaHeroBackground";

// Wrap everything:
<>
  <SylvaHeroBackground />
  <main style={{ position: "relative", zIndex: 1, ... }}>
    {/* ALL existing pipeline UI — logic unchanged */}
  </main>
</>
```

### Phase 3 — Design Overhaul (Styles Only)

7. **Replace the flat background** (`radial-gradient(ellipse at top, #0f172a, #020617)`) with the living 3D scene. Add a dark moss fallback for slow loads: `background: #0a1a0f`.

8. **Apply glassmorphism** to all pipeline cards and panels:

```css
/* Organic glass treatment for all cards */
.pipeline-card {
  background: rgba(10, 26, 15, 0.65);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid rgba(180, 220, 180, 0.12);
  border-radius: 20px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px rgba(180, 220, 180, 0.06);
}
```

9. **Re-skin the color palette** (keep all `#d4af37` gold for HH GOA branding):

| Element | Before | After |
|---------|--------|-------|
| Page bg | `#020617` gradient | Sylva 3D scene + `#0a1a0f` fallback |
| Card bg | `rgba(0,0,0,0.3)` | `rgba(10, 26, 15, 0.65)` + glass blur |
| Borders | `rgba(255,255,255,0.08)` | `rgba(180, 220, 180, 0.12)` |
| Text primary | `#f8fafc` | `#f0f7f0` (green-tinted white) |
| Text secondary | `#94a3b8` | `#8aab8a` (moss grey) |
| Active tab | `#0ea5e9 → #6366f1` | `#2d6a3f → #1a4025` (moss green) |
| Code text | `#38bdf8` | `#4ade80` (green highlight) |
| **Brand gold** | `#d4af37` | **Keep `#d4af37`** ← HH GOA identity |
| **Success** | `#10b981` | **Keep** ← fits the nature theme |
| **Error** | `#ef4444` | **Keep** ← universal signal |

### Phase 4 — Animation Enhancements

10. Add Sylva-inspired micro-animations to **existing elements** (don't add new UI):

| Element | Animation |
|---------|-----------|
| Page mount | Cards fade in with staggered 100ms delay, `opacity 0→1`, `translateY 12px→0` |
| Tab switcher | Smooth gradient transition (300ms ease), subtle scale 1→1.02 on active |
| Camera/upload toggle | Liquid-metal slide indicator (CSS transition on ::before pseudo) |
| Capture button | Organic pulse when face detected (keyframe breathing glow), moss-green hover |
| Pipeline steps | Staggered fade-in as each step completes (150ms delay between) |
| Blockchain proof card | Frosted glass with subtle green border-glow on "CONFIRMED" |
| Status indicator dot | Breathing animation: `box-shadow` pulse every 2s |
| Backend badge | Gentle opacity transition on status change |

11. All animations respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  .sylva-bg-iframe { display: none; }
}
```

### Phase 5 — Responsive & Polish

12. Verify desktop (1240px max-width), tablet (768px), and mobile (375px) layouts.
13. The iframe scene must not block scroll or pointer events: `pointer-events: none` on the scene layer.
14. Maintain all existing keyboard navigation and focus states.
15. Add `<meta name="description" content="HH GOA 2026 — Biometric Face Identification & EVM Blockchain Verification Pipeline">` if missing.

---

## Branding preservation checklist

- [ ] 🌴 Palm emoji in header
- [ ] "HH GOA" gold gradient heading (`linear-gradient(135deg, #d4af37, #ffdf00)`)
- [ ] "TASK #3 PIPELINE" badge with gold border
- [ ] "Biometric 128D Face Embedding & EVM Blockchain Verification Engine" subtitle
- [ ] Tab labels: "🚀 Task 3: Auto Web/Social & Blockchain", "⚡ 1-to-1 Verification", "📸 Face ID Registration"
- [ ] FastAPI backend health indicator (green/red dot)
- [ ] Backend offline guidance banner with `cd backend && python run.py`
- [ ] All pipeline step copy, status messages, and result labels verbatim

---

## Verification

After implementation, verify in the browser:

1. ✅ Sylva 3D scene renders at native resolution as a living background
2. ✅ All three tabs render correctly with the new glassmorphism design
3. ✅ Camera/upload, face detection, embedding, social search, and blockchain flows work identically
4. ✅ FastAPI health check badge still polls `localhost:8000`
5. ✅ No external network requests from the Sylva scene (all assets local)
6. ✅ Responsive layout on desktop and mobile
7. ✅ `prefers-reduced-motion` hides scene and disables animations
8. ✅ Browser console shows no errors
9. ✅ All HH GOA branding elements present and styled
10. ✅ Pipeline UI is interactive — pointer events pass through the background scene

---

## Guardrails

> [!CAUTION]
> - **Do NOT modify** any React component logic, state management, API calls, or event handlers
> - **Do NOT replace** HH GOA branding text with Sylva's own heading copy
> - **Do NOT approximate** the Sylva scene from screenshots or previews — use exact source
> - **Do NOT embed** the ThreeUI documentation page
> - **Do NOT import** the HTML document into the application JavaScript graph
> - **Do NOT remove** any existing pipeline functionality
> - **Do NOT make external network requests** — all Sylva assets must be local
> - If source cannot be fetched, **stop and report** — do not recreate from memory
