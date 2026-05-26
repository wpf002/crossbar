'use client';

import { useEffect, useRef, useState } from 'react';

type Flash = 'up' | 'down' | null;

/**
 * Returns a flash direction whenever `value` changes. Caller applies it as a
 * CSS animation class for ~600ms (see tailwind config — `price-flash-up/down`).
 */
export function usePriceFlash(value: number | null | undefined): Flash {
  const prev = useRef<number | null | undefined>(value);
  const [flash, setFlash] = useState<Flash>(null);

  useEffect(() => {
    if (value == null) {
      prev.current = value;
      return;
    }
    if (prev.current == null) {
      prev.current = value;
      return;
    }
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const t = window.setTimeout(() => setFlash(null), 650);
      prev.current = value;
      return () => window.clearTimeout(t);
    }
  }, [value]);

  return flash;
}
