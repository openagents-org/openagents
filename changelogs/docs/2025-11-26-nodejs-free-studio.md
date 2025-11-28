# Node.js-Free OpenAgents Studio

## Overview

Starting from version 0.6.16, OpenAgents Studio no longer requires Node.js or npm to be installed on your machine. The Studio frontend is now pre-built and bundled directly with the PyPI package, making installation and usage significantly simpler.

## What Changed

### Before (v0.6.15 and earlier)

Previously, running `openagents studio` required:

1. Node.js (v20 or higher recommended)
2. npm package manager
3. Automatic or manual `npm install` and build process
4. Potential troubleshooting for npm proxy configuration

### After (v0.6.16+)

Now, running `openagents studio` only requires:

1. Python with `openagents` package installed

That's it. No Node.js, no npm, no build steps.

## How It Works

### Build Pipeline

The Studio frontend is built during the PyPI package publishing process:

```
GitHub Actions (pypi-publish.yml)
    │
    ├── 1. Set up Node.js 20
    │
    ├── 2. Install dependencies (npm ci)
    │
    ├── 3. Build production bundle (npm run build)
    │
    ├── 4. Copy build output to src/openagents/studio/build/
    │
    └── 5. Package and publish to PyPI
```

### Package Structure

The built Studio files are included in the Python package:

```
openagents/
├── studio/
│   └── build/
│       ├── index.html
│       ├── static/
│       │   ├── css/
│       │   └── js/
│       └── ...
└── ...
```

### Runtime Behavior

When you run `openagents studio`, the CLI:

1. Locates the pre-built Studio files in the package
2. Starts a local HTTP server to serve the static files
3. Opens your default browser to the Studio URL

## Usage

### Quick Start

```bash
# Install OpenAgents
pip install openagents

# Initialize a network workspace
openagents init ./my_network

# Start the network
openagents network start ./my_network

# In another terminal, launch Studio (standalone mode)
openagents studio -s
```

### Command Options

```bash
# Launch Studio with a network
openagents studio

# Launch Studio in standalone mode (no network)
openagents studio -s

# Launch without opening browser (headless servers)
openagents studio --no-browser

# Specify custom port
openagents studio --port 8080
```

## Benefits

### Simplified Installation

- **No Node.js required**: Users don't need to install or manage Node.js
- **No npm issues**: Eliminates proxy configuration, version conflicts, and dependency issues
- **Faster setup**: Skip the `npm install` step entirely

### Consistent Experience

- **Pre-built bundle**: Every user gets the same tested build
- **No build variations**: Eliminates issues from different Node.js versions or npm configurations
- **Reliable deployment**: Works the same on all platforms

### Better for Production

- **Smaller footprint**: No need for Node.js runtime in production
- **Docker-friendly**: Simpler container images without Node.js
- **CI/CD ready**: Easier integration into Python-based pipelines

## CI/CD Integration

### Studio Build Check Workflow

A dedicated GitHub Actions workflow validates the Studio build on every commit:

```yaml
# .github/workflows/studio-build.yml
name: Studio Build Check

on:
  push:
    paths:
      - 'studio/**'
  pull_request:
    paths:
      - 'studio/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: cd studio && npm ci
    - run: cd studio && npm run lint
    - run: cd studio && npm run build
```

### PyPI Publish Workflow

The publish workflow automatically builds and bundles Studio:

```yaml
# .github/workflows/pypi-publish.yml
- name: Build Studio frontend
  run: |
    cd studio
    npm ci
    npm run build

- name: Copy Studio build to package
  run: |
    mkdir -p src/openagents/studio
    cp -r studio/build src/openagents/studio/
```

## Troubleshooting

### Studio Not Loading

If the Studio page doesn't load:

1. Check that you're using OpenAgents v0.6.16 or later:
   ```bash
   pip show openagents
   ```

2. Verify the Studio files are included:
   ```bash
   python -c "import openagents; print(openagents.__path__)"
   # Check if studio/build exists in that path
   ```

3. Try reinstalling:
   ```bash
   pip install --force-reinstall openagents
   ```

### Port Already in Use

If the default port is occupied:

```bash
openagents studio --port 8051
```

### Headless Server

For servers without a display:

```bash
openagents studio --no-browser
# Then access http://your-server-ip:8050 from your browser
```

## Migration Guide

### From v0.6.15 or Earlier

No migration needed! Simply upgrade:

```bash
pip install -U openagents
```

The new version will automatically use the bundled Studio without requiring Node.js.

### Cleaning Up (Optional)

If you previously installed the npm package globally, you can remove it:

```bash
npm uninstall -g openagents-studio
```

## Technical Details

### Build Configuration

The Studio uses Create React App with CRACO for customization:

- **React**: Frontend framework
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **gRPC-Web**: Communication with OpenAgents network

### Bundle Size

The production build is optimized for size:

- Code splitting for lazy loading
- Tree shaking to remove unused code
- Minification and compression
- Asset optimization

### Browser Compatibility

The bundled Studio supports:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Related Documentation

- [OpenAgents Quick Start Guide](https://openagents.org/docs/quickstart)
- [Studio User Guide](https://openagents.org/docs/studio)
- [Network Configuration](https://openagents.org/docs/network-config)
