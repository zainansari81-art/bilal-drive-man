import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Magic wizard animation shown when a download is launched.
 *
 * Full-body, side-view Gandalf silhouette (facing right) with a separate
 * animated staff. Sequence (~4.8s total):
 *
 *   0.0 – 0.6s  wizard rises in from below, hat settles
 *   0.6 – 2.8s  staff swings left/right in a casting motion (3 sweeps),
 *               pivoting around the wizard's hand
 *   2.8 – 3.2s  orb at staff tip charges up (halo + scale + brightness)
 *   3.0 – 3.8s  BURST — orb flashes, sparkles explode outward, shockwave
 *   3.2 – 4.3s  project card materialises from the burst, arcs into the
 *               download arrow below
 *   4.3 – 4.8s  scene fades
 *
 * onDone fires from `onAnimationEnd` on the wrap — tied to the real CSS
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

  // 16 sparkles exploding outward from the orb position after the charge-up.
  const sparkles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const distance = 130 + Math.random() * 90;
    const sx = Math.cos(angle) * distance;
    const sy = Math.sin(angle) * distance - 30;
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
        {/* Soft radial halo behind the wizard */}
        <span className="magic-anim-halo" />

        {/* === The wizard — full-body, side-view, facing RIGHT === */}
        {/* viewBox 280 x 600; hand at (238, 345) — the staff pivots there.
            Colors match the classic dusty-grey Gandalf palette. */}
        <svg
          className="magic-anim-wizard-svg"
          viewBox="0 0 280 600"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Main robe — cool grey with a slight blue cast */}
            <linearGradient id="wzRobeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4e5566" />
              <stop offset="50%" stopColor="#737b90" />
              <stop offset="100%" stopColor="#3c4354" />
            </linearGradient>
            {/* Hat — darker than robe, same family */}
            <linearGradient id="wzHatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2b3040" />
              <stop offset="60%" stopColor="#505668" />
              <stop offset="100%" stopColor="#2e3344" />
            </linearGradient>
            {/* Cloak / undercloak — shadowed charcoal */}
            <linearGradient id="wzCloak" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2a2d3a" />
              <stop offset="100%" stopColor="#14161e" />
            </linearGradient>
            {/* Skin */}
            <linearGradient id="wzSkin" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e8d5b4" />
              <stop offset="100%" stopColor="#c9b08a" />
            </linearGradient>
            {/* Beard / hair */}
            <linearGradient id="wzBeard" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fbf8ef" />
              <stop offset="100%" stopColor="#d7d1be" />
            </linearGradient>
          </defs>

          {/* ---- Cloak draped behind (visible past back shoulder) ---- */}
          <path
            d="M 88 220
               Q 66 285 56 365
               Q 50 450 58 540
               Q 70 558 108 556
               L 120 365
               Q 124 275 130 228 Z"
            fill="url(#wzCloak)"
          />
          {/* Cloak fold highlight */}
          <path
            d="M 92 260 Q 78 340 72 440 Q 70 510 80 540 L 96 540 Q 88 460 96 380 Q 100 310 104 250 Z"
            fill="#1e212b"
            opacity="0.6"
          />

          {/* ---- Main robe ---- */}
          <path
            d="M 120 220
               Q 100 290 92 370
               Q 86 455 88 545
               Q 96 566 126 566
               L 212 566
               Q 244 564 248 544
               Q 250 455 242 370
               Q 234 290 214 222
               Q 198 216 180 220
               L 140 220
               Q 128 216 120 220 Z"
            fill="url(#wzRobeGrad)"
          />
          {/* Robe vertical folds — deep shadows for form */}
          <path d="M 118 230 Q 108 310 102 400 Q 98 490 104 550 L 114 550 Q 108 470 114 380 Q 120 300 128 235 Z" fill="#3a414f" opacity="0.55" />
          <path d="M 150 232 Q 146 340 144 440 Q 142 520 146 558 L 154 558 Q 158 520 156 440 Q 154 340 158 232 Z" fill="#3a414f" opacity="0.4" />
          <path d="M 188 232 Q 192 340 196 440 Q 200 520 198 558 L 206 558 Q 210 520 208 440 Q 206 340 212 232 Z" fill="#3a414f" opacity="0.35" />
          {/* Robe highlight on front */}
          <path d="M 170 235 Q 176 340 178 440 Q 180 520 176 558 L 184 558 Q 188 520 186 440 Q 184 340 178 235 Z" fill="#8d94a8" opacity="0.3" />

          {/* Rope belt with hanging tassel */}
          <path
            d="M 100 378 Q 170 386 250 376 L 250 386 Q 170 396 100 388 Z"
            fill="#c8a564"
          />
          <path d="M 100 378 Q 170 386 250 376" stroke="#8e6f3d" strokeWidth="1" fill="none" opacity="0.5" />
          {/* Belt knot */}
          <ellipse cx="168" cy="386" rx="7" ry="5" fill="#a8864a" />
          {/* Tassel strands */}
          <path d="M 164 390 Q 160 410 156 428 L 162 430 Q 166 410 168 390 Z" fill="#c8a564" />
          <path d="M 172 390 Q 174 410 178 428 L 184 428 Q 180 410 176 390 Z" fill="#c8a564" />
          <path d="M 168 390 L 170 432 L 174 432 L 172 390 Z" fill="#a8864a" />

          {/* Boots peeking below hem */}
          <ellipse cx="118" cy="572" rx="22" ry="7" fill="#120a04" />
          <ellipse cx="208" cy="572" rx="22" ry="7" fill="#120a04" />
          <path d="M 98 558 Q 100 574 118 576 Q 138 574 138 558 Z" fill="#2e1a08" />
          <path d="M 188 558 Q 190 574 208 576 Q 228 574 228 558 Z" fill="#2e1a08" />
          {/* Boot shine */}
          <path d="M 106 562 Q 108 568 114 568" stroke="#4a2f15" strokeWidth="1.2" fill="none" opacity="0.8" />
          <path d="M 196 562 Q 198 568 204 568" stroke="#4a2f15" strokeWidth="1.2" fill="none" opacity="0.8" />

          {/* ---- Back arm / sleeve drape (partly visible behind body) ---- */}
          <path
            d="M 118 230
               Q 98 270 92 320
               Q 90 355 104 362
               L 120 352
               Q 114 310 122 265 Z"
            fill="#2e3341"
          />

          {/* ---- Front arm extending forward to grip staff ---- */}
          <path
            d="M 196 232
               Q 218 244 238 262
               Q 252 280 256 305
               Q 258 328 248 348
               L 226 354
               Q 232 326 222 302
               Q 212 282 194 262
               Q 188 250 190 236 Z"
            fill="#5a6278"
          />
          {/* Arm fold shadow */}
          <path
            d="M 200 245 Q 220 264 234 285 Q 246 305 244 330 L 234 338 Q 236 310 226 290 Q 212 268 198 252 Z"
            fill="#3a414f"
            opacity="0.7"
          />
          {/* Wide sleeve cuff */}
          <path
            d="M 222 334
               L 264 352
               L 258 372
               L 218 360 Z"
            fill="#2b3040"
          />
          <path
            d="M 222 334 L 264 352"
            stroke="#6c7388" strokeWidth="1" opacity="0.7"
          />

          {/* ---- Long flowing beard (the signature feature) ---- */}
          {/* Main mass */}
          <path
            d="M 154 220
               Q 162 260 158 308
               Q 152 360 144 400
               Q 136 425 128 418
               Q 118 395 115 355
               Q 112 300 118 248
               Q 122 228 128 218
               Q 142 230 154 220 Z"
            fill="url(#wzBeard)"
          />
          {/* Beard strand lines for a flowing look */}
          <path d="M 128 240 Q 125 290 128 340 Q 132 380 136 405" stroke="#cfc8b2" strokeWidth="1.3" fill="none" opacity="0.6" />
          <path d="M 138 238 Q 137 300 140 360 Q 141 395 140 415" stroke="#cfc8b2" strokeWidth="1.3" fill="none" opacity="0.5" />
          <path d="M 148 236 Q 150 300 148 360 Q 146 400 142 418" stroke="#cfc8b2" strokeWidth="1.2" fill="none" opacity="0.45" />
          <path d="M 120 250 Q 118 300 120 350 Q 124 385 130 410" stroke="#b8b1a0" strokeWidth="1" fill="none" opacity="0.5" />
          {/* Beard pointed tip */}
          <path d="M 126 410 Q 130 424 134 418 Q 136 410 132 405 Z" fill="url(#wzBeard)" />
          {/* Beard undershadow against robe */}
          <path d="M 118 268 Q 116 330 120 380 Q 124 405 126 415 Q 122 410 119 395 Q 113 340 115 275 Z" fill="#afa898" opacity="0.55" />

          {/* ---- Head (profile, facing right) ---- */}
          <path
            d="M 122 158
               Q 112 180 112 208
               Q 114 222 124 228
               L 150 228
               Q 162 226 168 218
               Q 176 220 182 212
               Q 190 210 196 204
               Q 206 202 212 194
               Q 218 184 214 174
               Q 220 168 218 162
               Q 214 156 208 156
               L 134 156
               Q 126 156 122 158 Z"
            fill="url(#wzSkin)"
          />
          {/* Cheek warmth */}
          <ellipse cx="188" cy="198" rx="8" ry="5" fill="#d89b7a" opacity="0.35" />

          {/* Nose — jutting forward in profile */}
          <path
            d="M 204 170
               Q 220 172 222 184
               Q 220 194 214 196
               Q 206 194 202 188
               Q 200 178 204 170 Z"
            fill="url(#wzSkin)"
          />
          <path d="M 215 178 Q 220 184 218 192" stroke="#9a7d5a" strokeWidth="0.8" fill="none" opacity="0.5" />
          {/* Nostril */}
          <ellipse cx="213" cy="192" rx="1.5" ry="1" fill="#5a3e22" opacity="0.6" />

          {/* Brow shadow under hat brim */}
          <path
            d="M 158 163 Q 180 158 204 164 Q 206 172 200 176 Q 178 176 160 172 Z"
            fill="#2a2238"
            opacity="0.45"
          />

          {/* Bushy eyebrow */}
          <path
            d="M 172 160
               Q 184 153 200 158
               Q 206 162 200 165
               Q 186 164 176 166
               Q 170 165 172 160 Z"
            fill="url(#wzBeard)"
          />
          <path d="M 174 161 Q 180 158 188 159" stroke="#cfc8b2" strokeWidth="0.8" fill="none" opacity="0.8" />

          {/* Deep-set eye */}
          <ellipse cx="188" cy="175" rx="3" ry="2.4" fill="#fbf8ef" />
          <ellipse cx="189" cy="175" rx="1.8" ry="2" fill="#3a5a8a" />
          <circle cx="189.5" cy="174.5" r="1.1" fill="#0a1428" />
          <circle cx="190" cy="174" r="0.4" fill="#ffffff" />

          {/* Ear */}
          <path
            d="M 138 186
               Q 132 192 134 202
               Q 136 210 142 210
               Q 144 200 143 192 Z"
            fill="url(#wzSkin)"
          />
          <path d="M 138 194 Q 138 200 141 204" stroke="#9a7d5a" strokeWidth="0.8" fill="none" opacity="0.6" />

          {/* Hair wisp under hat at back of head */}
          <path
            d="M 112 180 Q 104 190 102 206 Q 106 214 114 214 Q 120 200 118 184 Z"
            fill="url(#wzBeard)"
          />

          {/* Mustache flowing over mouth into beard */}
          <path
            d="M 192 200
               Q 208 204 212 214
               Q 206 220 198 218
               Q 190 216 186 210
               Q 184 204 192 200 Z"
            fill="url(#wzBeard)"
          />
          <path
            d="M 186 210 Q 178 212 170 214 Q 162 218 156 222 L 168 222 Q 178 220 188 216 Z"
            fill="url(#wzBeard)"
          />

          {/* ---- Hat brim (tilted for side view) ---- */}
          <ellipse
            cx="148" cy="156" rx="58" ry="9"
            fill="#151827"
            transform="rotate(-4 148 156)"
          />
          {/* Brim highlight */}
          <ellipse
            cx="148" cy="152" rx="58" ry="3"
            fill="#4a5066"
            opacity="0.5"
            transform="rotate(-4 148 152)"
          />

          {/* ---- Hat cone (tall, floppy Gandalf silhouette) ---- */}
          <path
            d="M 100 156
               Q 96 125 100 90
               Q 106 58 118 38
               Q 130 20 148 18
               Q 164 20 172 38
               Q 180 62 184 95
               Q 188 130 190 156
               Z"
            fill="url(#wzHatGrad)"
          />
          {/* Hat tip — bent forward/down (classic Gandalf floppy tip) */}
          <path
            d="M 148 18
               Q 168 14 186 24
               Q 192 36 180 46
               Q 168 40 156 30
               Q 150 24 148 18 Z"
            fill="#1a1d2b"
          />
          {/* Tip shadow where it folds */}
          <path
            d="M 172 24 Q 184 28 184 38 Q 178 42 170 38 Q 168 30 172 24 Z"
            fill="#0e1018"
            opacity="0.7"
          />
          {/* Hat crease / front shadow */}
          <path
            d="M 132 35 Q 126 75 120 125 Q 116 145 114 156 L 126 156 Q 128 140 132 115 Q 136 75 142 40 Z"
            fill="#1e2230"
            opacity="0.6"
          />
          {/* Hat front-edge highlight */}
          <path
            d="M 148 22 Q 160 30 170 50 Q 176 90 182 154 L 188 154 Q 186 125 180 85 Q 172 50 162 30 Q 154 22 148 22 Z"
            fill="#6a7088"
            opacity="0.35"
          />
          {/* Hat band where it meets brim */}
          <path
            d="M 102 150 Q 148 156 188 150 L 188 158 Q 148 164 102 158 Z"
            fill="#0a0c16"
            opacity="0.7"
          />

          {/* ---- Hand gripping the staff ---- */}
          <g>
            <ellipse cx="238" cy="345" rx="12" ry="14" fill="url(#wzSkin)" />
            {/* Knuckle ridge */}
            <path
              d="M 230 340 Q 238 336 246 340 Q 244 346 238 346 Q 232 346 230 340 Z"
              fill="#c9a07a"
              opacity="0.7"
            />
            {/* Thumb */}
            <ellipse cx="245" cy="336" rx="4" ry="6" fill="url(#wzSkin)" />
            {/* Knuckle shadows */}
            <path d="M 234 344 Q 238 346 242 344" stroke="#9a7d5a" strokeWidth="0.8" fill="none" opacity="0.5" />
          </g>
        </svg>

        {/* === The staff — separate overlay, pivots at hand (340, 345 wrap) === */}
        <div className="magic-anim-staff">
          <svg viewBox="0 0 60 420" preserveAspectRatio="xMidYMid meet">
            <defs>
              <radialGradient id="wzOrbGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="35%" stopColor="#ede9fe" />
                <stop offset="70%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#5b21b6" />
              </radialGradient>
              <linearGradient id="wzWoodGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3a220f" />
                <stop offset="50%" stopColor="#8b5a2b" />
                <stop offset="100%" stopColor="#2e1a08" />
              </linearGradient>
            </defs>
            {/* Staff shaft (grip at y=250, orb at y=28) */}
            <line
              x1="30" y1="405" x2="30" y2="30"
              stroke="url(#wzWoodGrad)"
              strokeWidth="6"
              strokeLinecap="round"
            />
            {/* Knots along the shaft */}
            <circle cx="30" cy="120" r="2.5" fill="#2a1608" opacity="0.7" />
            <circle cx="30" cy="200" r="2.5" fill="#2a1608" opacity="0.7" />
            <circle cx="30" cy="320" r="2.5" fill="#2a1608" opacity="0.7" />
            {/* Claw-mount holding the orb */}
            <path
              d="M 18 30 Q 22 38 30 40 Q 38 38 42 30 L 40 22 Q 30 26 20 22 Z"
              fill="#5a3a1f"
            />
            {/* Orb glow halo */}
            <circle cx="30" cy="22" r="16" fill="#a78bfa" opacity="0.35" className="magic-anim-orb-halo" />
            {/* Orb */}
            <circle cx="30" cy="22" r="10" fill="url(#wzOrbGrad)" className="magic-anim-orb" />
            {/* Orb highlight */}
            <circle cx="27" cy="19" r="3" fill="#ffffff" opacity="0.7" />
          </svg>
        </div>

        {/* Shockwave ring expanding from the orb */}
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
