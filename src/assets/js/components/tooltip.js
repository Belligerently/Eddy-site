// One shared tooltip, rendered in a portal like Vortex's .ui-tooltip-portal, for elements with [data-tooltip]:
// icon-only buttons (text from aria-label) and sidebar links while the rail is collapsed
// ([data-tooltip-when="nav-collapsed"]). The tooltip only repeats the element's own accessible name, so it is
// aria-hidden. It opens on mouse hover and keyboard focus (never on touch), closes on leave, blur, Escape,
// scroll, press and page hide, and never takes pointer events.

import { afterAnimation } from '../lib/motion.js';

const GAP = 12;
const EDGE = 8;

export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.append(tip);

  let anchor = null;
  let pending = null; // a rail link waiting for the rail's width transition to finish

  const label = (el) => el.dataset.tooltip || el.getAttribute('aria-label') || '';
  const allowed = (el) => {
    const when = el.dataset.tooltipWhen;
    return !when || document.documentElement.classList.contains(when);
  };

  function place() {
    const a = anchor.getBoundingClientRect();
    // Layout size, not getBoundingClientRect(): the pop-in animation scales the tooltip.
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left;
    let top;
    if (anchor.closest('.side-nav')) {
      // Beside the rail, vertically centred on the link.
      left = a.right + GAP;
      top = a.top + (a.height - h) / 2;
      tip.style.setProperty('--popup-origin', 'left center');
    } else {
      // Below the control, centred, kept inside the viewport.
      left = Math.min(Math.max(a.left + (a.width - w) / 2, EDGE), innerWidth - w - EDGE);
      top = a.bottom + EDGE;
      tip.style.setProperty('--popup-origin', 'top center');
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function show(el) {
    pending = null;
    if (!allowed(el) || !label(el)) return hide();
    // While the rail is still collapsing, its links are still moving: placing the tooltip now would leave it
    // stranded where the link edge was. Wait for the rail to settle, then show it if the link is still wanted.
    if (el.closest('.side-nav')) {
      const moving = document.querySelector('.shell')?.getAnimations() ?? [];
      if (moving.length) {
        hide();
        pending = el;
        Promise.allSettled(moving.map((a) => a.finished)).then(() => pending === el && show(el));
        return;
      }
    }
    anchor = el;
    tip.textContent = label(el);
    tip.hidden = false;
    tip.dataset.motionState = 'open';
    place();
  }

  function hide() {
    pending = null;
    if (!anchor) return;
    anchor = null;
    tip.dataset.motionState = 'closing';
    afterAnimation(tip, () => (tip.hidden = true), () => anchor === null);
  }

  /** The anchor's label or visibility rule may have changed (e.g. the sidebar toggled). */
  function refresh() {
    const el = anchor ?? pending;
    if (el) show(el);
  }

  const target = (e) => (e.target instanceof Element ? e.target.closest('[data-tooltip]') : null);

  document.addEventListener('pointerover', (e) => {
    const el = target(e);
    if (el && e.pointerType === 'mouse' && el !== anchor) show(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = target(e);
    if (el && (el === anchor || el === pending) && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el && el.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', (e) => {
    const el = target(e);
    if (el && (el === anchor || el === pending)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', hide);
  addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('blur', hide);
  // A resize moves the anchor (or hides it, across the mobile breakpoint): follow it, or close.
  addEventListener(
    'resize',
    () => {
      if (!anchor) return;
      if (anchor.getClientRects().length && allowed(anchor)) place();
      else hide();
    },
    { passive: true },
  );
  addEventListener('pagehide', () => {
    anchor = null;
    pending = null;
    tip.hidden = true;
  });

  return { refresh, hide };
}
