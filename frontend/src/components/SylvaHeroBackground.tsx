"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * The Sylva "Living Green" moss-root world, used as this app's hero.
 *
 * It loads /landing-pages/sylva-scene.html — the authored Three.js scene with
 * the landing page's own nav, headline and product cards stripped out, so the
 * only thing behind the masthead is the world itself.
 *
 * The scene is anchored to the top of the document rather than fixed to the
 * viewport. Its composition puts fog at the top and the moss root across the
 * bottom, so letting it occupy one screen turns the moss into a horizon: the
 * masthead sits in the fog where white text reads cleanly, and the dense data
 * panels below start on solid ground instead of competing with foliage.
 *
 * Cost control lives here. The authored scene is built for a discrete GPU —
 * 250,000 instanced blades is 1.5M triangles per frame, with MSAA at up to 2x
 * device pixel ratio. That is far past budget for integrated graphics, so the
 * GPU is probed once and the scene is asked for a workload that matches it.
 */

type Tier = "high" | "low";

/** Blade count, multisampling and pixel-ratio cap per tier. */
const TIER_SETTINGS: Record<Tier, { blades: number; aa: 0 | 1; dpr: number }> = {
  // The scene's own defaults.
  high: { blades: 190000, aa: 1, dpr: 2 },
  // The scene's own narrow-viewport preset (70k/14.7k), which its authors
  // already tuned to stay lush. Going lower thins the moss visibly - at 34k
  // the bark shows through and the root reads moth-eaten. Together with no
  // MSAA and 1x pixel ratio this is ~66% fewer triangles and ~36% fewer
  // pixels than the desktop default.
  low: { blades: 70000, aa: 0, dpr: 1 },
};

/**
 * Integrated and mobile GPUs cannot carry the authored workload. There is no
 * capability query for "how fast is this GPU", so match the renderer string —
 * the same heuristic WebGL-heavy sites use. Unknown GPUs get the low tier:
 * a slightly thinner scene everywhere beats an unusable one on slow machines.
 */
function detectTier(): Tier {
  if (typeof document === "undefined") return "low";
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ||
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "low";

    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : "";

    if (!renderer) return "low";

    // Software rasterisers and integrated/mobile parts.
    if (/swiftshader|llvmpipe|softwar|basic render/i.test(renderer)) return "low";
    if (/(intel).*(uhd|hd graphics|iris|gma)/i.test(renderer)) return "low";
    if (/adreno|mali|powervr|apple a\d/i.test(renderer)) return "low";

    // Discrete parts and Apple Silicon carry the full scene comfortably.
    if (/nvidia|geforce|rtx|gtx|radeon|rx \d|arc a\d|apple m\d/i.test(renderer)) {
      return "high";
    }
    return "low";
  } catch {
    return "low";
  }
}

export function SylvaHeroBackground() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    setTier(detectTier());
    return () => mql.removeEventListener("change", handler);
  }, []);

  const src = useMemo(() => {
    if (!tier) return null;
    const s = TIER_SETTINGS[tier];
    return `/landing-pages/sylva-scene.html?blades=${s.blades}&aa=${s.aa}&dpr=${s.dpr}`;
  }, [tier]);

  // The hero is one screen tall at the top of a long page. Once it scrolls
  // away the scene is invisible but still drawing every frame, so park it.
  //
  // Derived from scrollY rather than an IntersectionObserver on purpose: the
  // hero's geometry is known exactly (one viewport, pinned to the top), and
  // scrollY is a cheap synchronous read that cannot get stuck. An observer
  // here can miss its re-entry callback when the compositor is throttled,
  // which would strand the scene at the parked frame rate for the session.
  useEffect(() => {
    if (!src) return;

    let parked: boolean | null = null;
    const post = (visible: boolean) => {
      if (parked === !visible) return; // only on change
      parked = !visible;
      frameRef.current?.contentWindow?.postMessage(
        { type: "sylva:visibility", visible },
        window.location.origin
      );
    };

    const update = () =>
      post(!document.hidden && window.scrollY < window.innerHeight);

    // The iframe may not have a contentWindow yet on the first pass, so
    // re-assert once it has loaded.
    const frame = frameRef.current;
    const onLoad = () => { parked = null; update(); };
    frame?.addEventListener("load", onLoad);

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      frame?.removeEventListener("load", onLoad);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [src]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "100svh",
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        // Painted beneath the scene so there is never a flash of empty ground
        // while the Three.js world builds its geometry.
        background:
          "linear-gradient(180deg, #4a4d44 0%, #474a41 55%, #3b3e36 100%)",
      }}
    >
      {!reducedMotion && src && (
        <iframe
          ref={frameRef}
          src={src}
          title=""
          tabIndex={-1}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: "none",
            pointerEvents: "none",
            animation: "rise 1.4s cubic-bezier(.16,1,.3,1) both",
          }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}

      {/* Legibility wash over the fog, where the masthead sits. Kept light so
          the moss keeps its modelling. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(26,29,21,0.52) 0%, rgba(26,29,21,0.30) 34%, rgba(26,29,21,0.06) 55%, rgba(26,29,21,0) 70%)",
        }}
      />

      {/* Horizon: the scene resolves into the page ground so the content below
          has a flat surface to sit on. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "42%",
          background:
            "linear-gradient(180deg, rgba(56,59,52,0) 0%, rgba(48,51,44,0.55) 42%, rgba(41,44,37,0.90) 74%, #383b34 100%)",
        }}
      />
    </div>
  );
}
