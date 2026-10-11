# Eddy website

The website for **Eddy**, an independent browser extension that adds unofficial item values to
[Vortex](https://playvortex.io). It explains what Eddy does, what its values mean, its privacy model, and its release
status. The extension itself is **not released**, and the site says so.

The site is separate from the extension (`../vortex-extension/`). It shares no code, build or runtime with it, needs
no extension installed, and has no backend.

## Commands

Requires Node.js ≥ 22.4. There are **no npm dependencies**, so `npm install` is optional (it installs nothing).

```sh
npm run dev           # dev server → http://127.0.0.1:4600/ (renders from src/ on each request)
npm run build         # production build → dist/
npm run preview       # build, then serve dist/ as a static host would
npm test              # unit tests (node:test): build output, links, JS modules, Ko-fi, tokens, radii, contrast
npm run test:browser  # real-browser test of dist/ (headless Chromium, 5 viewports, ~65 checks); screenshots → .smoke/
npm run verify        # all of the above
```

`--port=NNNN` (or `PORT=NNNN`) changes the server port. `test:browser` finds Playwright's Chrome for Testing,
then installed Chrome, Brave or Chromium; set `BROWSER=/path/to/chrome` to choose one.

`dist/` is plain static files. Any static host can serve it, from a domain root or a sub-path (links are relative).
Configure the host to serve `404.html` for unknown paths. Nothing is deployed by these scripts.

## Structure

```
site.config.js            name, Ko-fi URL, extension version
src/site.js               the page list: routes, labels, icons, nav groups, titles
src/layout.js             shared shell: top bar, sidebar, mobile tab bar, footer
src/icons.js              inline SVG icons and the Eddy mark
src/pages/*.html          page bodies (placeholders: {{icon:name}} {{mark}} {{link:id}} {{version}})
src/assets/styles/tokens.css   design tokens (colour, type, space, shape, size, motion; dark + light)
src/assets/styles/site.css     layout and components (colours only via tokens)
src/assets/js/main.js     entry module; the site works without JS (toggles hidden, everything else intact)
src/assets/js/components/ sidebar.js (collapse), theme.js, tooltip.js (portal), indicator.js (page-change slide)
src/assets/js/lib/        preferences.js (theme/sidebar storage, bfcache resync), motion.js (reduced-motion)
src/assets/fonts/         Figtree (self-hosted, SIL OFL 1.1, licence included)
scripts/                  build, dev/preview server, browser test (+ a small CDP client)
tests/                    unit tests
```

To add a page, write `src/pages/<name>.html` and add an entry to `PAGES` in `src/site.js`. It then appears in both
navigations, the build and the tests.

## Design

The site follows the visual language Vortex and Voltimons share:

- **Palette.** Vortex's own `--palette-*` values, from captures of playvortex.io recorded in
  `vortex-extension/docs/VORTEX_VISUAL_REFERENCE.md` and re-checked live on 2026-10-10. The palette includes the
  `#120b1b` shell, `#08050e` content panel, `#15151f` cards and `#24242f` / `#33334a` borders. It also includes
  `#9a9aab` muted text, `#a78bfa` links and the `#c084fc` focus ring. Voltimons' `ink` scale (from its live CSS,
  2026-10-10) uses the same values.
- **Type.** Figtree (Vortex's font), with Vortex's type scale and weights.
- **Shell.** Vortex's measured layout: an 82px top bar, and a 200px rail of 40px links (16px/600, radius 8, 12px
  icon gap). The current page is filled purple. A hairline separates the tools group (Get Eddy), like Vortex's
  Studio/Download.
- **Collapsible rail.** The ✕ / ☰ button collapses the rail to a 40px icon strip; labels then appear as tooltips on
  hover and keyboard focus.
- **Mobile (≤ 800px).** The rail becomes a floating bottom tab bar, the pattern both Vortex (`.site-mobile-bar`) and
  Voltimons use.
- **Components.** Vortex's 16px-radius `.ui-card`, settings-style rows, 40px buttons with radius 8, and pill badges.
- **Themes.** Dark by default, like Vortex. Light uses Vortex's light tokens.

### Rounded corners

Radii use Vortex's scale (`--radius-sm` 4 · `md` 6 · `lg` 8 · `xl` 12 · `2xl` 16 · `full`), read from
playvortex.io/css/tokens.css. Voltimons, measured live, uses the same steps: 12px buttons and 16px cards.
Components use semantic aliases from `tokens.css`:

| Token | Radius | Used for |
|---|---|---|
| `--radius-control` | 8 | buttons, icon buttons, nav links, the skip link, the Ko-fi ghost button |
| `--radius-tooltip` | 6 | the tooltip portal (Vortex `.ui-tooltip-portal`) |
| `--radius-panel` | 12 | the main content panel (Vortex `.site-main`) |
| `--radius-widget` | 12 | banners, empty-state icon tiles |
| `--radius-card` | 16 | cards, row groups, tables, empty states (Vortex `.ui-card`) |
| `--radius-pill` | 999 | badges and the mobile tab bar |
| `--radius-mark` | 4 | inline code |

Tab-bar items are concentric with the bar: the bar's radius minus its padding and border. Rounded containers clip
their content (`overflow: hidden`, or `auto` for tables). The tests check every radius and that nothing overflows.

### Motion

Motion uses Vortex's own tokens and patterns from playvortex.io/css/motion.css: 150ms state changes, a 300ms
layout change and a 500ms reveal.

- **Hover and press:** colour and background changes on buttons, links, nav items and cards, plus a 2px arrow
  nudge on link cards.
- **Sidebar:** collapsing animates the rail's width. Labels fade and slide 8px, the divider shrinks to 24px, and
  the ✕/☰ icons cross-fade with a small scale.
- **Current-page fill:** on a page change, the fill slides from the link you clicked to the new one (a FLIP
  animation in `indicator.js`).
- **Tooltips:** the tooltip portal pops in from 0.98 scale.
- **Sections:** each page's sections fade up 8px, staggered 18ms apart, capped at 180ms.
- **Linked rows:** a row reached from a Home card is briefly highlighted.
- **Performance:** only `transform`, `opacity`, colours and the rail width animate, and the tests measure zero
  layout shift.
- **Reduced motion:** under `prefers-reduced-motion`, every motion token is 0ms and no animation runs.
- **Rules found in the animation audit** (each has a browser regression test):
  - The theme switch and a restored page (Back or another tab) apply their state in one frame, with
    interaction transitions suppressed (`withoutTransitions`). Only the theme button's own icons animate.
  - Hover styles apply only under `@media (hover: hover)`, so taps leave no sticky hover; `:active` gives
    touch feedback.
  - The sliding fill always passes under labels (`z-index` 0 vs 1 inside the rail and tab bar).
  - The fill is hidden before first paint (`indicator-pending`) until its slide starts, so it never appears at
    its destination first and then jumps.
  - A rail tooltip waits for the rail to stop moving before it opens. Tooltips follow their control on
    resize, and close when it disappears.
  - Exit animations count as over when cancelled, not just when they end.
- **No view transitions.** Chrome sends all input to `<html>` while a view transition runs, so clicks made during
  one are lost. Instead, the theme switches instantly and page changes use the FLIP slide. A test guards this.

**Deliberate deviation.** Purple fills behind white text use `#9333ea` (Vortex's own hover purple), not `#a855f7`,
because white on `#a855f7` is 3.96:1, under WCAG AA for body-size text. The extension's pages make the same choice.

Contrast for every text and UI pair, in both themes, is tested in `tests/tokens.test.js`.

## Ko-fi

The footer of every page has one "Support Eddy on Ko-fi" link to `https://ko-fi.com/zaflalo`. That is the destination
the extension already uses (`vortex-extension/extension/shared/links.js`, provided by the maintainer).

- It is a plain link that opens in a new tab with `rel="noopener noreferrer"`. No widget, script or tracking is
  involved, and nothing loads from Ko-fi until the link is clicked.
- To change or hide the link, edit `kofiUrl` in `site.config.js`. An empty value removes the link, and the build
  warns about it.

## Privacy

The site has no analytics, cookies, third-party requests or web-font services. It remembers two preferences, the
theme and the sidebar state, in the browser's `localStorage`. The tests fail if a third-party script, stylesheet,
font or network call is added.

## Limitations

- The design was matched against captures of Vortex, which were taken signed in by the owner, and against live,
  signed-out views of Vortex and Voltimons (2026-10-10). Vortex's own mobile layout was not captured, so its bottom
  bar is reproduced from measured CSS values, not from screenshots.
- There are no forms, dropdown menus, dialogs or asynchronous operations, so there are no loading states, form
  validation or modal animations. None were added for their own sake.
- The site's content mirrors the extension's README and docs as of version 0.2.2. Update `site.config.js` and the
  pages when the extension changes.
