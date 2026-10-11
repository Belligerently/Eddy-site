// Motion helpers. CSS handles nearly all animation (tokens.css sets every duration to 0 under reduced motion);
// JS only needs the preference before starting a scripted animation or waiting for an exit animation.

const query = matchMedia('(prefers-reduced-motion: reduce)');

export const prefersReducedMotion = () => query.matches;

/**
 * Call `done` once `el`'s current CSS animation is over, or at once when nothing is animating (reduced motion,
 * no animation defined). "Over" includes being cancelled (e.g. reduced motion switched on mid-way, which removes
 * the animation without an `animationend`). `isCurrent` lets the caller ignore a stale end if the state changed
 * meanwhile.
 */
export function afterAnimation(el, done, isCurrent = () => true) {
  const running = el.getAnimations();
  if (!running.length || prefersReducedMotion()) {
    done();
    return;
  }
  const settle = () => isCurrent() && done();
  Promise.allSettled(running.map((a) => a.finished)).then(settle);
}

/**
 * Apply a state change without the interaction transitions it would otherwise trigger. Theme colours and a
 * restored sidebar state are not interactions: letting each element's 150ms hover transition run on them makes
 * parts of the page fade while the rest snaps, and makes a restored page animate from its stale state.
 * Styles are flushed with transitions off, so removing the guard straight after starts nothing.
 * `keepControlFeedback` (a click on the theme button) leaves that button's own sun/moon cross-fade running
 * (site.css .theme-switching); a restore passes nothing, so nothing at all animates.
 */
export function withoutTransitions(update, { keepControlFeedback = false } = {}) {
  const root = document.documentElement;
  const guard = keepControlFeedback ? 'theme-switching' : 'no-transitions';
  root.classList.add(guard);
  try {
    update();
    void getComputedStyle(root).color;
    void document.body.offsetHeight;
  } finally {
    root.classList.remove(guard);
  }
}
