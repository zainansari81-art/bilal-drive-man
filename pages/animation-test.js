import { useState } from 'react';
import DownloadMagicAnimation from '../components/DownloadMagicAnimation';

/**
 * Isolated test harness for the wizard/wand download animation.
 * Renders a single button that plays DownloadMagicAnimation without
 * triggering any real download, API call, or state change in the portal.
 *
 * Route: /animation-test
 * Safe to visit in prod — does nothing but show the animation.
 */
export default function AnimationTest() {
  const [playing, setPlaying] = useState(false);
  const [projectName, setProjectName] = useState('Test Project');
  const [playCount, setPlayCount] = useState(0);

  const handlePlay = () => {
    setPlaying(true);
  };

  const handleDone = () => {
    setPlaying(false);
    setPlayCount((n) => n + 1);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'linear-gradient(135deg, #1a0b2e 0%, #2d1b4e 100%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 24,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28 }}>Wizard Animation Test</h1>
      <p style={{ margin: 0, opacity: 0.75, textAlign: 'center', maxWidth: 480 }}>
        Isolated harness. Clicking Play triggers the animation only — no
        download, no API calls, no state changes anywhere else in the portal.
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 280 }}>
        <span style={{ fontSize: 13, opacity: 0.75 }}>Project name (shown on card)</span>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #4a3070',
            background: '#1a0b2e',
            color: '#fff',
            fontSize: 14,
          }}
        />
      </label>

      <button
        onClick={handlePlay}
        disabled={playing}
        style={{
          padding: '14px 28px',
          borderRadius: 10,
          border: 'none',
          background: playing ? '#4a3070' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          cursor: playing ? 'not-allowed' : 'pointer',
          boxShadow: playing ? 'none' : '0 8px 24px rgba(124, 58, 237, 0.4)',
        }}
      >
        {playing ? 'Playing…' : 'Play animation'}
      </button>

      <div style={{ fontSize: 13, opacity: 0.6 }}>
        Plays so far: {playCount}
      </div>

      {playing && (
        <DownloadMagicAnimation
          projectName={projectName}
          onDone={handleDone}
        />
      )}
    </div>
  );
}
