'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * `reducedMotion="user"` makes every motion component honour the OS setting
 * without each one having to branch on it: transform and layout animations
 * are dropped, opacity still cross-fades. That is the documented accessible
 * behaviour, and it covers the animations that are not worth a branch.
 *
 * Components that change *structure* based on the preference use
 * `useMotionPreference()` instead, which is safe to read during render.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
