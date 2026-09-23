// Wrap a polling callback so it skips while the browser tab is hidden.
// Nobody is looking at a background tab, and every poll costs a Vercel
// function invocation plus Supabase egress (free tier = 5 GB/month).
export function whenVisible(fn) {
  return (...args) => {
    if (typeof document !== 'undefined' && document.hidden) return undefined;
    return fn(...args);
  };
}
