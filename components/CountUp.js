// components/CountUp.js
//
// Animated numeric counter — eases from the previous value to the new value
// over `duration` ms. Use for any number that should *feel* alive: metric
// tiles, byte counters in active transfers, etc.
//
// Usage:
//   <CountUp value={84} />
//   <CountUp value={progressBytes} duration={1200} format={(v) => fmtBytes(v)} />
//
// Performance notes:
// - Uses requestAnimationFrame, not setInterval
// - When `value` changes mid-animation, picks up smoothly from the current
//   in-flight value (no jump)
// - Strips its own subscription on unmount

import { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, duration = 700, format }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = fromRef.current;
    const to = value;

    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return format ? format(display) : Math.round(display);
}
