import '../styles/globals.css';

// Font links are in pages/_document.js — NOT here. A <link rel="stylesheet">
// added via next/head triggers Next's `body{display:none}` FOUC guard, which
// blanks the whole page if the font CDN is slow or unreachable.
export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
