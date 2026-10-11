// Motion helpers. CSS handles nearly all animation (tokens.css sets every duration to 0 under reduced motion);
// JS only needs the preference before starting a scripted animation or waiting for an exit animation.

const query = matchMedia('(prefers-reduced-motion: reduce)');

export const prefersReducedMotion = () => query.matches;

/**
 * Call `done` when `el`'s current CSS animation ends, or at once when nothing is animating (reduced motion,
 * no animation defined). `isCurrent` lets the caller ignore a stale end if the state changed meanwhile.
 */
export function afterAnimation(el, done, isCurrent = () => true) {
  const running = el.getAnimations().length > 0;
  if (!running || prefersReducedMotion()) {
    done();
    return;
  }
  el.addEventListener('animationend', () => isCurrent() && done(), { once: true });
}
