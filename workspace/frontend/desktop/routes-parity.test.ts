import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// The desktop build has no file-system router: every `app/**/page.tsx` the
// launcher can reach has to be registered by hand in desktop/app.tsx. A page
// added only on the Next side opens fine on the web and 404s in the launcher
// (settings/connected-apps did exactly that).
//
// Pages that only make sense in a browser are listed here instead.
const WEB_ONLY = new Set([
  '/login', // the launcher signs in through central login
  '/auth/callback',
  '/auth/desktop',
  '/oauth/authorize', // third-party OAuth consent
  '/share/artifact/:token', // public links opened by people outside the app
  '/share/file/:token',
]);

const APP_DIR = join(__dirname, '..', 'app');

function nextRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return nextRoutes(path);
    if (name !== 'page.tsx') return [];
    const route = '/' + relative(APP_DIR, dir).split(/[\\/]/).filter(Boolean)
      .map((segment) => segment.replace(/^\[(\w+)\]$/, ':$1')).join('/');
    return [route];
  });
}

it('registers every Next page in the desktop router or marks it web-only', () => {
  const source = readFileSync(join(__dirname, 'app.tsx'), 'utf8');
  const missing = nextRoutes(APP_DIR).filter(
    (route) => !WEB_ONLY.has(route) && !source.includes(`'${route}'`),
  );
  expect(missing).toEqual([]);
});
