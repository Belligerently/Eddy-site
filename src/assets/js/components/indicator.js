// The current-page fill (Vortex's selection indicator) slides from the link you clicked on the previous page to
// its place on the new one, in the sidebar and in the mobile tab bar.
//
// A FLIP animation, not a view transition: Chrome routes all input to <html> while a view transition runs, which
// would swallow clicks for its duration. Here the new page is fully interactive from the first frame and the
// indicator (pointer-events: none) just moves. The sidebar and tab bar sit at the same viewport position on every
// page (sticky / fixed), so the old rectangle is valid on the new page.

import { prefersReducedMotion } from '../lib/motion.js';

const KEY = 'eddy-site.indicator';
const MAX_AGE = 1500; // ms; a slower page load just skips the animation
const SOURCES = [
  { kind: 'nav', link: '.side-nav .nav-link', indicator: '.nav-indicator' },
  { kind: 'tab', link: '.tab-bar .tab-link', indicator: '.tab-indicator' },
];

function remember(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  for (const s of SOURCES) {
    const link = e.target instanceof Element ? e.target.closest(s.link) : null;
    if (!link || link.getAttribute('aria-current') === 'page') continue;
    const current = document.querySelector(s.indicator);
    if (!current) return;
    const r = current.getBoundingClientRect();
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ kind: s.kind, x: r.left, y: r.top, w: r.width, h: r.height, at: Date.now() }));
    } catch {
      // Storage blocked: the page simply changes without the slide.
    }
    return;
  }
}

function arrive() {
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
  if (!saved || Date.now() - saved.at > MAX_AGE || prefersReducedMotion()) return;
  const source = SOURCES.find((s) => s.kind === saved.kind);
  const el = source && document.querySelector(source.indicator);
  if (!el || !el.getClientRects().length) return; // e.g. the window crossed the mobile breakpoint
  const r = el.getBoundingClientRect();
  const dx = saved.x - r.left;
  const dy = saved.y - r.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

  const link = el.parentElement;
  const parsed = parseFloat(getComputedStyle(el).getPropertyValue('--indicator-duration'));
  const duration = Number.isFinite(parsed) ? parsed : 300;
  if (duration === 0) return;
  // Until the fill arrives, the link keeps its ordinary text colour, so the label stays readable on the page.
  link.classList.add('is-arriving');
  const animation = el.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${saved.w / r.width}, ${saved.h / r.height})` }, { transform: 'none' }],
    { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
  );
  const done = () => link.classList.remove('is-arriving');
  animation.finished.then(done, done);
}

export function initIndicator() {
  document.addEventListener('click', remember);
  arrive();
}
