// Dark / light theme toggle. The switch is instant and uniform: every colour changes in the same frame, with the
// elements' hover transitions suppressed (withoutTransitions), so no part of the page lags behind. A cross-fade
// would need a view transition, and Chrome routes all input to <html> while one runs. The button's own sun/moon
// icons still cross-fade.

import { isLight, setTheme } from '../lib/preferences.js';
import { withoutTransitions } from '../lib/motion.js';

export function initTheme() {
  const button = document.querySelector('.theme-toggle');
  if (!button) return { sync() {} };

  // aria-pressed reports whether the light theme is on; the name stays constant ("Light theme").
  const sync = () => button.setAttribute('aria-pressed', String(isLight()));

  button.addEventListener('click', () => {
    withoutTransitions(
      () => {
        setTheme(isLight() ? 'dark' : 'light');
        sync();
      },
      { keepControlFeedback: true },
    );
  });

  sync();
  return { sync };
}
