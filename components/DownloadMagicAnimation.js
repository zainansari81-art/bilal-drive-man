import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Magic wizard animation shown when a download is launched.
 *
 * Sequence (~4.8s total):
 *   0.0 – 0.6s  Gandalf-style wizard rises in from below, hat settles
 *   0.6 – 2.8s  Staff waves through 3 figure-8 casting motions
 *   2.8 – 3.2s  Orb at staff tip charges up (grows + brightens)
 *   3.0 – 3.8s  Magic burst: sparkles explode outward + shockwave ring
 *   3.4 – 4.3s  Project card flies out of the magic and into the
 *               download arrow below
 *   4.3 – 4.8s  Scene fades out
 *
 * onDone fires from `onAnimationEnd` on the wrap — tied to the real
 * CSS animation lifecycle so parent re-renders can't race it.
 */
export default function DownloadMagicAnimation({ projectName, onDone }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleAnimationEnd = (e) => {
    // Only fire on the wrap's own animation-end, not bubbled-up child events.
    if (e.target !== e.currentTarget) return;
    if (onDone) onDone();
  };

  // 16 sparkles bursting outward from the staff tip after the charge-up.
  const sparkles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const distance = 120 + Math.random() * 80;
    const sx = Math.cos(angle) * distance;
    const sy = Math.sin(angle) * distance - 30; // bias upward
    const ss = 0.9 + Math.random() * 1.4;
    const sr = 360 + Math.floor(Math.random() * 720);
    const delayMs = Math.floor(Math.random() * 200);
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
          animationDelay: `${(3.0 + delayMs / 1000).toFixed(2)}s`,
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
        {/* Soft radial glow behind the wizard */}
        <span className="magic-anim-halo" />

        {/* The wizard himself — SVG Gandalf-style silhouette */}
        <svg
          className="magic-anim-wizard-svg"
          viewBox="0 0 200 310"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="robeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7a7094" />
              <stop offset="100%" stopColor="#4d4664" />
            </linearGradient>
            <linearGradient id="hatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6a6386" />
              <stop offset="100%" stopColor="#3a3450" />
            </linearGradient>
          </defs>

          {/* Robe body */}
          <path
            d="M 55 145 Q 48 165 42 300 L 158 300 Q 152 165 145 145 Z"
            fill="url(#robeGrad)"
          />
          {/* Robe center-fold shadow */}
          <path
            d="M 100 145 L 96 300 L 104 300 Z"
            fill="#2f2a42"
            opacity="0.45"
          />
          {/* Left sleeve (viewer's left — wizard's staff hand) */}
          <path
            d="M 58 150 Q 35 180 40 225 L 62 218 Q 68 185 72 160 Z"
            fill="#524b68"
          />
          {/* Right sleeve */}
          <path
            d="M 142 150 Q 165 180 160 225 L 138 218 Q 132 185 128 160 Z"
            fill="#524b68"
          />

          {/* Face */}
          <ellipse cx="100" cy="108" rx="17" ry="19" fill="#e0cfb2" />

          {/* Beard — long and flowing */}
          <path
            d="M 83 118
               Q 80 155 92 180
               Q 96 195 100 198
               Q 104 195 108 180
               Q 120 155 117 118
               Q 114 130 100 135
               Q 86 130 83 118 Z"
            fill="#f1ede3"
          />
          {/* Beard shadow */}
          <path
            d="M 88 130 Q 90 150 96 168 Q 100 175 100 135 Z"
            fill="#c8c2b3"
            opacity="0.45"
          />

          {/* Mustache */}
          <path
            d="M 88 118 Q 94 124 100 122 Q 106 124 112 118 Q 106 130 100 128 Q 94 130 88 118 Z"
            fill="#f1ede3"
          />

          {/* Eye shadows under hat brim */}
          <ellipse cx="93" cy="104" rx="2.5" ry="2" fill="#1a1428" opacity="0.75" />
          <ellipse cx="107" cy="104" rx="2.5" ry="2" fill="#1a1428" opacity="0.75" />

          {/* Nose hint */}
          <path d="M 100 108 Q 98 115 100 118 Q 102 115 100 108 Z" fill="#c4b396" opacity="0.6" />

          {/* Hat brim */}
          <ellipse cx="100" cy="84" rx="40" ry="6.5" fill="#2a2440" />

          {/* Hat cone — bent Gandalf silhouette */}
          <path
            d="M 100 8
               Q 112 6 122 12
               Q 115 22 108 42
               Q 102 62 98 78
               Q 94 82 88 84
               L 114 84
               Q 118 78 115 65
               Q 115 40 118 22
               Q 112 14 100 8 Z"
            fill="url(#hatGrad)"
          />
          {/* Hat back-side shadow */}
          <path
            d="M 100 8 Q 90 12 80 28 Q 76 55 74 82 L 88 84 Q 94 82 98 78 Q 102 62 108 42 Q 115 22 122 12 Q 112 6 100 8 Z"
            fill="#2e2840"
            opacity="0.55"
          />

          {/* Hand gripping staff (viewer's left — wizard's right hand) */}
          <ellipse cx="62" cy="205" rx="9" ry="10" fill="#e0cfb2" />
          <ellipse cx="62" cy="205" rx="9" ry="10" fill="#2a2238" opacity="0.15" />
        </svg>

        {/* The staff — separate so it can swing independently around the hand pivot */}
        <div className="magic-anim-staff">
          <svg viewBox="0 0 40 240" preserveAspectRatio="xMidYMid meet">
            <defs>
              <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="40%" stopColor="#e9d5ff" />
                <stop offset="75%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#5b21b6" />
              </radialGradient>
              <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#5a3a1f" />
                <stop offset="50%" stopColor="#8b5a2b" />
                <stop offset="100%" stopColor="#4a2f18" />
              </linearGradient>
            </defs>
            {/* Staff shaft */}
            <line
              x1="20" y1="235" x2="20" y2="35"
              stroke="url(#woodGrad)" strokeWidth="5.5" strokeLinecap="round"
            />
            {/* Staff knots */}
            <circle cx="20" cy="100" r="2" fill="#3a2412" opacity="0.6" />
            <circle cx="20" cy="170" r="2" fill="#3a2412" opacity="0.6" />
            {/* Orb glow halo */}
            <circle cx="20" cy="28" r="14" fill="#a78bfa" opacity="0.35" className="magic-anim-orb-halo" />
            {/* Orb itself */}
            <circle cx="20" cy="28" r="9" fill="url(#orbGrad)" className="magic-anim-orb" />
          </svg>
        </div>

        {/* Shockwave ring that expands after the burst */}
        <span className="magic-anim-shockwave" />

        {/* Sparkle burst */}
        {sparkles}

        {/* The project card that flies into the download target */}
        <div className="magic-anim-card">
          <span className="magic-anim-card-icon">{'\u{1F4E6}'}</span>
          <span className="magic-anim-card-name">
            {projectName || 'Project'}
          </span>
        </div>

        {/* Download-target arrow at the bottom */}
        <span className="magic-anim-target">{'\u{2B07}'}</span>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return content;
  return createPortal(content, document.body);
}
