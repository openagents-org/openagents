module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Tailwind v4 targets Chrome 111 / Safari 16.4. Older engines — common in
    // vendor and in-app browsers on phones — drop every rule inside `@layer`
    // and every `oklch()` colour, leaving the page unstyled. Flatten the
    // layers and add rgb fallbacks; modern engines keep the original colours.
    // (Tailwind already guards its own `color-mix()` with fallbacks.)
    // Tailwind nests every variant's at-rule inside its selector
    // (`.sm\:flex { @media (width >= 40rem) { … } }`), which the layer
    // flattener silently drops — every sm:/md:/lg:, hover: and dark: rule went
    // missing. Unnest first so the flattener sees plain rules.
    'postcss-nesting': {},
    '@csstools/postcss-cascade-layers': {},
    '@csstools/postcss-oklab-function': { preserve: true },
  },
};
