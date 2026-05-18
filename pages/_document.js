import { Html, Head, Main, NextScript } from 'next/document';

// Font links live here (NOT in _app.js via next/head). Adding a
// <link rel="stylesheet"> through next/head makes Next.js inject a
// `body{display:none}` FOUC guard that only clears once the sheet loads —
// if the font CDN is slow or unreachable the page stays blank forever.
// Document-level <Head> ships the links in the initial HTML with no guard.
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
