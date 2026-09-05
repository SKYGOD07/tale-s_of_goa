# Tales of Goa — Sylva Design Overhaul Tasks

## Phase 1: Asset Setup
- [/] Fetch inner-green-3d.html from ThreeUI canonical URL
- [ ] Download three.min.js runtime
- [ ] Download lexend-latin.woff2 font
- [ ] Download card-ecostove.jpg
- [ ] Download card-ethos.jpg
- [ ] Verify all assets load at localhost:3000/landing-pages/inner-green-3d.html

## Phase 2: Hero Scene Component
- [ ] Create `SylvaHeroBackground.tsx` iframe wrapper component
- [ ] Integrate into page.tsx as fixed background layer

## Phase 3: Design Overhaul (Styles Only)
- [ ] Update globals.css with organic design system (variables, glassmorphism utilities)
- [ ] Reskin page.tsx — replace flat gradient, apply glassmorphism to all cards/panels
- [ ] Remap color palette to moss-green organic tones (preserve #d4af37 gold branding)
- [ ] Update tab switcher styles to organic green gradient
- [ ] Apply glass treatment to backend health badge and status indicators

## Phase 4: Animation Enhancements
- [ ] Add staggered fade-in on page mount
- [ ] Add smooth tab transition animations
- [ ] Add organic pulse on capture button when face detected
- [ ] Add breathing glow on status indicator dots
- [ ] Add border-glow on blockchain proof card confirmation

## Phase 5: Responsive & Polish
- [ ] Verify desktop/tablet/mobile layouts with 3D background
- [ ] Ensure pointer-events pass through to pipeline UI
- [ ] Add prefers-reduced-motion support
- [ ] Browser console clean — no errors
- [ ] Verify all three tabs work identically to before
