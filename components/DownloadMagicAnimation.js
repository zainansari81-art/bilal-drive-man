import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';

// Lottie player is client-only — ship it via dynamic import with SSR off.
// Also point the player at the self-hosted WASM in /public so our CSP
// (which only allows 'self' + Supabase + Notion for connect-src) doesn't
// block the jsdelivr/unpkg fallback URLs the player uses by default.
const DotLottieReact = dynamic(
  () =>
    import('@lottiefiles/dotlottie-react').then((m) => {
      m.setWasmUrl('/dotlottie-player.wasm');
      return m.DotLottieReact;
    }),
  { ssr: false }
);

/**
 * Magic mascot animation shown when a download is launched.
 *
 * Uses the "Red Cat With A Witch's Hat" Lottie by Alexander Rozhkov on
 * LottieFiles (downloaded to /public/cat.lottie so we're not hotlinking
 * their CDN). Real vector Lottie at 60fps.
 *
 * Sequence (~4.8s total):
 *   0.0 – 4.2s  Lottie mascot plays (loops for the full duration)
 *   2.4 – 3.4s  burst of sparkles + shockwave ring above the mascot
 *   2.8 – 4.3s  project card materialises and flies into the download arrow
 *   4.3 – 4.8s  scene fades
 *
 * onDone fires from onAnimationEnd on the wrap — tied to the real CSS
 * animation lifecycle so parent re-renders can't race it.
 */
export default function DownloadMagicAnimation({ projectName, onDone }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleAnimationEnd = (e) => {
    if (e.target !== e.currentTarget) return;
    if (onDone) onDone();
  };

  // 16 sparkles exploding outward from above the wizard's head.
  const sparkles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const distance = 130 + Math.random() * 90;
    const sx = Math.cos(angle) * distance;
    const sy = Math.sin(angle) * distance - 20;
    const ss = 0.9 + Math.random() * 1.4;
    const sr = 360 + Math.floor(Math.random() * 720);
    const delayMs = Math.floor(Math.random() * 220);
    const emoji = ['\u2728', '\u{1F31F}', '\u{2B50}', '\u2728', '\u{1F4AB}'][i % 5];
    return (
      <span
        key={i}
        className="magic-anim-sparkle"
        style={{
          '--sx': `${sx.toFixed(0)}px`,
          '--sy': `${sy.toFixed(0)}px`,
          '--ss': ss.toFixed(2),
          '--sr': `${sr}deg`,
          animationDelay: `${(2.4 + delayMs / 1000).toFixed(2)}s`,
        }}
      >
        {emoji}
      </span>
    );
  });

  const content = (
    <div
      className="delete-modal-overlay"
      style={{ background: 'rgba(20, 8, 45, 0.72)' }}
    >
      <div
        className="magic-anim-wrap"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={handleAnimationEnd}
      >
        {/* Soft radial halo behind the wizard */}
        <span className="magic-anim-halo" />

        {/* The Lottie wizard */}
        <div className="magic-anim-lottie">
          <DotLottieReact
            src="/cat.lottie"
            autoplay
            loop
            speed={1}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Shockwave ring */}
        <span className="magic-anim-shockwave" />

        {/* Sparkle burst */}
        {sparkles}

        {/* Project card that flies into the download arrow */}
        <div className="magic-anim-card">
          <span className="magic-anim-card-icon">{'\u{1F4E6}'}</span>
          <span className="magic-anim-card-name">
            {projectName || 'Project'}
          </span>
        </div>

        {/* Download target */}
        <span className="magic-anim-target">{'\u{2B07}'}</span>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return content;
  return createPortal(content, document.body);
}
