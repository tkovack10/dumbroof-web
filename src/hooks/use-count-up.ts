"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated count-up hook — Robinhood-style number animation.
 * Eases from 0 to target over `duration` ms.
 */
export function useCountUp(target: number, duration = 2000, delay = 0): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number>(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }

    const timeout = setTimeout(() => {
      startTime.current = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime.current;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));

        if (progress < 1) {
          animRef.current = requestAnimationFrame(animate);
        }
      };

      animRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(animRef.current);
    };
  }, [target, duration, delay]);

  return value;
}
