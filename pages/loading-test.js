import LoadingAnimation from '../components/LoadingAnimation';

/**
 * Isolated test harness for the shared LoadingAnimation component.
 * Shows the Lottie "No Internet" loader in all three sizes on one page
 * so we can eyeball whether it actually renders — this is what the
 * history/downloading/projects screens flash while data is fetching.
 *
 * Route: /loading-test
 * Safe in prod — does no API calls and has no auth requirement.
 */
export default function LoadingTest() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a0b2e 0%, #2d1b4e 100%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '40px 24px',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Loading Screen Test</h1>
        <p style={{ margin: '0 0 32px', opacity: 0.75 }}>
          Isolated harness for <code>LoadingAnimation</code>. If the wizard on
          <code> /animation-test</code> works but the loader here is blank, the
          bug is the component/CSS rather than the WASM.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
          }}
        >
          {['sm', 'md', 'lg'].map((size) => (
            <div
              key={size}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid #4a3070',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>
                size=&quot;{size}&quot;
              </div>
              <LoadingAnimation
                label={`Loading (${size})...`}
                size={size}
                padding={20}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 40, fontSize: 12, opacity: 0.5 }}>
          The loader is used on: History page, Downloading Projects list, any
          other in-portal fetch that flashes a spinner. Those render behind the
          login gate, so if you&apos;re not logged in you won&apos;t see them
          in the portal itself — that&apos;s what this page is for.
        </div>
      </div>
    </div>
  );
}
