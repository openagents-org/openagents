module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Tailwind v4 targets Chrome 111 / Safari 16.4. Older engines — common in
    // vendor and in-app browsers on phones — drop every rule inside `@layer`
    // and every `oklch()` colour, leaving the page unstyled. Flatten the
    // layers and add rgb fallbacks; modern engines keep the original colours.
    // (Tailwind already guards its own `color-mix()` with fallbacks.)
    '@csstools/postcss-cascade-layers': {},
    '@csstools/postcss-oklab-function': { preserve: true },
  },
};
