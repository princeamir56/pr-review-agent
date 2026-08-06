import { useEffect, useRef, useState } from "react";

export function CountUp({ value, duration = 700 }: { value: number; duration?: number }): JSX.Element {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>();
  const from = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const startVal = from.current;
    const delta = value - startVal;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(startVal + delta * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, duration]);

  return <>{display}</>;
}
