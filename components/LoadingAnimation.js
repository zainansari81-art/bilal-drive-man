import dynamic from 'next/dynamic';

// Lottie player is client-only — next/dynamic with ssr:false keeps it out
// of the SSR bundle so it doesn't choke on `document`/`window`.
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
 * Shared loading-screen component used across the portal. Wraps the
 * "No Internet" Lottie (downloaded to /public/loading.lottie) plus an
 * optional caption. Used by every in-portal fetch spinner — history,
 * downloading-projects list, etc. The download splash has its own
 * mascot (the wizard in DownloadMagicAnimation) so the two screens
 * stay visually distinct.
 *
 * Props:
 *   label?  — caption shown below the animation (default "Loading...")
 *   size?   — 'sm' | 'md' | 'lg' (default 'md')
 *   padding? — outer vertical padding in px (default 40)
 *
 * Usage:
 *   <LoadingAnimation label="Loading projects..." />
 */
export default function LoadingAnimation({
  label = 'Loading...',
  size = 'md',
  padding = 40,
}) {
  const dim = size === 'sm' ? 120 : size === 'lg' ? 260 : 180;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${padding}px 16px`,
        color: '#8c8ca1',
        gap: 8,
      }}
    >
      <div style={{ width: dim, height: dim }}>
        <DotLottieReact
          src="/loading.lottie"
          autoplay
          loop
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {label ? (
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{label}</p>
      ) : null}
    </div>
  );
}
