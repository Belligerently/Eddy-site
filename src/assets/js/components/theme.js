// Dark / light theme toggle. The switch is instant: a cross-fade would need a view transition, and Chrome routes
// all input to <html> while one runs, so the page would ignore clicks for its duration. The button's own sun/moon
// icons cross-fade in CSS.

import { isLight, setTheme } from '../lib/preferences.js';

export function initTheme() {
  const button = document.querySelector('.theme-toggle');
  if (!button) return { sync() {} };

  // aria-pressed reports whether the light theme is on; the name stays constant ("Light theme").
  const sync = () => button.setAttribute('aria-pressed', String(isLight()));

  button.addEventListener('click', () => {
    setTheme(isLight() ? 'dark' : 'light');
    sync();
  });

  sync();
  return { sync };
}
