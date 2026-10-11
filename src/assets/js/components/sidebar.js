// Sidebar collapse/expand (Vortex's ✕ / ☰ button). CSS animates the rail width and the labels; this keeps the
// button's state and name in sync and remembers the choice.

import { isNavCollapsed, setNavCollapsed } from '../lib/preferences.js';

export function initSidebar({ onChange } = {}) {
  const button = document.querySelector('.nav-toggle');
  if (!button) return { sync() {} };

  const sync = () => {
    const collapsed = isNavCollapsed();
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
  };

  button.addEventListener('click', () => {
    setNavCollapsed(!isNavCollapsed());
    sync();
    onChange?.();
  });

  sync();
  return { sync };
}
