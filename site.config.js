// Site-wide settings. Edit values here; nothing else needs to change.

export default {
  name: 'Eddy',
  tagline: 'Unofficial value tools for Vortex',

  /**
   * Optional Ko-fi support link, shown once in the shared footer. This is the same destination the extension's
   * settings page and popup use (vortex-extension/extension/shared/links.js, "provided by the maintainer,
   * 2026-10-10"). Set to '' to hide the link everywhere; the build prints a warning when it is empty.
   */
  kofiUrl: 'https://ko-fi.com/zaflalo',

  /** Shown in the footer and on the Get Eddy page. Keep in step with the extension's package.json. */
  extensionVersion: '0.2.5',

  /**
   * The URL path the site is served from: '/' at a domain root, or e.g. '/Eddy-site/' for a project sub-path. Only
   * 404.html uses it (a host serves that page at any depth, so its links must be root-absolute); every other page
   * links relatively and works anywhere. Must start and end with '/'.
   */
  basePath: '/',
};
