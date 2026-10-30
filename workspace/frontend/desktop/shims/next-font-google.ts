/**
 * `next/font/google`, for the desktop build.
 *
 * The web build downloads and self-hosts the font at build time and hands back
 * a generated class name. The desktop build ships the family with the app (see
 * desktop/index.html) and hands back the class that applies it — same call
 * signature, so the layout code is unchanged.
 */
interface FontResult {
  className: string;
  style: { fontFamily: string };
  variable: string;
}

function font(): FontResult {
  return {
    className: 'font-inter',
    style: { fontFamily: 'Inter, system-ui, sans-serif' },
    variable: '--font-inter',
  };
}

export const Inter = font;
export const Roboto = font;
