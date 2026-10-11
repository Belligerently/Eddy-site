// The site's pages, in navigation order. Each page's body is an HTML fragment in src/pages/; the shared shell
// (top bar, sidebar, mobile bar, footer) comes from src/layout.js. Add a page here and it appears in both
// navigations, the build and the tests.

export const PAGES = [
  {
    id: 'home',
    path: '/',
    file: 'home.html',
    label: 'Home',
    icon: 'home',
    group: 'main',
    title: 'Eddy · Unofficial value tools for Vortex',
    description: 'Eddy is an independent browser extension that adds unofficial item values to Vortex. Not yet released.',
  },
  {
    id: 'features',
    path: '/features/',
    file: 'features.html',
    label: 'Features',
    icon: 'features',
    group: 'main',
    title: 'Features · Eddy',
    description: 'What Eddy does today, what is planned, and which browsers it has been tested in.',
  },
  {
    id: 'values',
    path: '/values/',
    file: 'values.html',
    label: 'Values',
    icon: 'values',
    group: 'main',
    title: 'What the values mean · Eddy',
    description: 'Catalog price, RAP, estimated value and worth: what each figure in Eddy means and where it comes from.',
  },
  {
    id: 'privacy',
    path: '/privacy/',
    file: 'privacy.html',
    label: 'Privacy',
    icon: 'privacy',
    group: 'main',
    title: 'Privacy · Eddy',
    description: 'The permissions Eddy asks for, the requests it makes, what it stores, and what it never collects.',
  },
  {
    id: 'get',
    path: '/get-eddy/',
    file: 'get-eddy.html',
    label: 'Get Eddy',
    icon: 'download',
    group: 'tools',
    title: 'Get Eddy',
    description: 'Eddy is not released yet. Why, and what has to happen first.',
  },
];

/** Rendered to 404.html; not in the navigation. */
export const NOT_FOUND = {
  id: '404',
  path: '/404.html',
  file: '404.html',
  title: 'Page not found · Eddy',
  description: 'This page does not exist.',
};

/** Output file for a route: "/" → "index.html", "/features/" → "features/index.html". */
export function outputFile(page) {
  if (page.path.endsWith('.html')) return page.path.slice(1);
  return `${page.path.slice(1)}index.html`;
}
