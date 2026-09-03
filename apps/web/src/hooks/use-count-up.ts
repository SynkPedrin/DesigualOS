import { useEffect, useRef, useState } from 'react';

export function useCountUp(target: number, durationMs = 700) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    let frame: number;

    function tick(timestamp: number) {
      startRef.current ??= timestamp;
      const progress = Math.min(1, (timestamp - startRef.current) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(fromRef.current + (target - fromRef.current) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
