// The site's two remembered preferences: theme and sidebar state. Stored only in this browser's localStorage and
// never sent anywhere. The inline script in each page's <head> applies the same values before first paint; this
// module is the single place that reads, writes and (re-)applies them afterwards.

const KEYS = { theme: 'eddy-site.theme', nav: 'eddy-site.nav' };
const root = document.documentElement;

function read(key) {
  try {
    return localStorage.getItem(KEYS[key]);
  } catch {
    return null; // Storage can be blocked (private windows, site-data settings).
  }
}

function write(key, value) {
  try {
    localStorage.setItem(KEYS[key], value);
  } catch {
    // Not persisted, but the change still applies to this page.
  }
}

export const isLight = () => root.dataset.theme === 'light';
export const isNavCollapsed = () => root.classList.contains('nav-collapsed');

export function setTheme(theme, { save = true } = {}) {
  root.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isLight() ? meta.dataset.light : meta.dataset.dark;
  if (save) write('theme', root.dataset.theme);
}

export function setNavCollapsed(collapsed, { save = true } = {}) {
  root.classList.toggle('nav-collapsed', collapsed);
  if (save) write('nav', collapsed ? 'collapsed' : 'expanded');
}

/** Re-apply the stored values, e.g. when a page comes back from the back/forward cache or another tab changed them. */
export function applyStored() {
  setTheme(read('theme') === 'light' ? 'light' : 'dark', { save: false });
  setNavCollapsed(read('nav') === 'collapsed', { save: false });
}

export const STORAGE_KEYS = Object.values(KEYS);
