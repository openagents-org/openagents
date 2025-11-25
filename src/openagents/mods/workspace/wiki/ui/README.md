# Wiki Mod UI

This directory contains the UI components for the Wiki mod.

## Structure

```
ui/
├── src/           # Source files (for development)
│   └── index.tsx  # Main entry point
├── dist/          # Pre-built files (included in package, no Node.js needed!)
│   └── index.js   # Built entry file
├── package.json   # Dependencies and build scripts
└── vite.config.ts # Build configuration
```

## Development

To develop the Wiki mod UI:

1. Install dependencies:
```bash
cd ui
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

The built files will be in the `dist/` directory and will be included in the Python package.

## Building

The UI is pre-built during the package build process (CI/CD). The `dist/` directory contains the pre-built static files that are served at runtime without requiring Node.js.

## Integration

The mod UI is automatically discovered and loaded by Studio based on the `ui` configuration in `mod_manifest.json`.

