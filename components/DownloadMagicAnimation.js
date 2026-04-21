import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Magic wizard animation shown when a download is launched.
 * The wizard pops in, waves a wand, sparkles burst out, and the project
 * card flies into a download arrow — signalling the download has started.
 *
 * Duration: ~2.4s total. onDone fires when the animation finishes.
 */
export default function DownloadMagicAnimation({ projectName, onDone }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      if (onDone) onDone();
    }, 2400);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = '';
    };
  }, [onDone]);

  // 12 sparkles bursting outward at varied angles, distances, sizes.
  const sparkles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const distance = 80 + Math.random() * 60;
    const sx = Math.cos(angle) * distance;
    const sy = Math.sin(angle) * distance - 20; // bias upward
    const ss = 0.8 + Math.random() * 1.2;
    const sr = 360 + Math.floor(Math.random() * 540);
    const delayMs = Math.floor(Math.random() * 180);
    const emoji = ['\u2728', '\u{1F31F}', '\u{2B50}', '\u2728'][i % 4];
    return (
      <span
        key={i}
        className="magic-anim-sparkle"
        style={{
          '--sx': `${sx.toFixed(0)}px`,
          '--sy': `${sy.toFixed(0)}px`,
          '--ss': ss.toFixed(2),
          '--sr': `${sr}deg`,
          animationDelay: `${(1.15 + delayMs / 1000).toFixed(2)}s`,
        }}
      >
        {emoji}
      </span>
    );
  });

  const content = (
    <div className="delete-modal-overlay" style={{ background: 'rgba(30, 10, 55, 0.55)' }}>
      <div className="magic-anim-wrap" onClick={(e) => e.stopPropagation()}>
        <span className="magic-anim-halo" />
        <span className="magic-anim-wizard">{'\u{1F9D9}'}</span>
        <span className="magic-anim-wand">{'\u{1FA84}'}</span>
        {sparkles}
        <div className="magic-anim-card">
          <span className="magic-anim-card-icon">{'\u{1F4E6}'}</span>
          <span className="magic-anim-card-name">
            {projectName || 'Project'}
          </span>
        </div>
        <span className="magic-anim-target">{'\u{2B07}'}</span>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return content;
  return createPortal(content, document.body);
}
