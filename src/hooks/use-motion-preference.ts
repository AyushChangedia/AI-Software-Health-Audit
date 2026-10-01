'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Reduced-motion preference that is safe to branch on during render.
 *
 * `useReducedMotion()` resolves to `null` on the server and to the real value
 * on the client, so branching on it directly changes the markup between the
 * server render and hydration — React then throws a hydration mismatch, and
 * the page falls back to a full client re-render.
 *
 * This returns `false` for the first render on both sides, then the real
 * preference once mounted. Entry animations are additionally neutered by the
 * `prefers-reduced-motion` block in `globals.css` and by `MotionConfig
 * reducedMotion="user"` at the root, so a reduced-motion visitor does not see
 * a burst of movement in the gap.
 */
export function useMotionPreference(): boolean {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? Boolean(reduced) : false;
}
