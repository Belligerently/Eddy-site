// Entry point (an ES module, so it runs once per page, after parsing). Everything here is an enhancement: with
// JavaScript off the site still renders and navigates, and the two toggles are hidden (site.css, html:not(.js)).

import { initIndicator } from './components/indicator.js';
import { initSidebar } from './components/sidebar.js';
import { initTheme } from './components/theme.js';
import { initTooltips } from './components/tooltip.js';
import { applyStored, STORAGE_KEYS } from './lib/preferences.js';
import { withoutTransitions } from './lib/motion.js';

const root = document.documentElement;

const tooltips = initTooltips();
const sidebar = initSidebar({ onChange: tooltips.refresh });
const theme = initTheme();
initIndicator();

// Bring the page up to date with the stored preferences. This is a correction, not an interaction, so it is
// applied without transitions (a restored page must not animate from its stale state).
function resync() {
  withoutTransitions(() => {
    applyStored();
    sidebar.sync();
    theme.sync();
  });
  tooltips.hide();
}

// A page restored from the back/forward cache keeps the state it had when you left it; bring it up to date
// with any change made on the page you came back from.
addEventListener('pageshow', (e) => {
  if (e.persisted) resync();
});

// Another tab changed a preference.
addEventListener('storage', (e) => {
  if (e.key === null || STORAGE_KEYS.includes(e.key)) resync();
});

// While the window is being resized, layout transitions are off, so crossing a breakpoint never animates the
// rail (Vortex does the same with .site-navigation-resizing).
let resizeTimer;
addEventListener(
  'resize',
  () => {
    root.classList.add('is-resizing');
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => root.classList.remove('is-resizing'), 150);
  },
  { passive: true },
);

root.classList.add('js-ready');
