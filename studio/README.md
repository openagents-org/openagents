# OpenAgents Studio

Web interface for OpenAgents networks built with React and TypeScript.

## Configuration

### Environment Variables

#### Proxy Configuration

The studio can be configured to proxy API requests to a local network port using the following environment variables:

- `OPENAGENTS_HTTP_TRANSPORT_PROXY` - Set to `true` to enable proxying `/api/*` requests to localhost (default: `false`)
- `OPENAGENTS_HTTP_TRANSPORT_PORT` - Port number for localhost proxy (default: `8700`)

**Examples:**

```bash
# Enable proxy to localhost:8700 (default port)
OPENAGENTS_HTTP_TRANSPORT_PROXY=true npm start

# Enable proxy to localhost:9000 (custom port)
OPENAGENTS_HTTP_TRANSPORT_PROXY=true OPENAGENTS_HTTP_TRANSPORT_PORT=9000 npm start

# Disable proxy (uses default remote proxy)
OPENAGENTS_HTTP_TRANSPORT_PROXY=false npm start
# or simply
npm start
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Documentation

- [Studio Frontend Documentation](./STUDIO_FRONTEND_DOCUMENTATION.md)
- [Password Verification Implementation](./PASSWORD_VERIFICATION_IMPLEMENTATION.md)
- [Collaborative Editor](./COLLABORATIVE_EDITOR_README.md)
- [Collaborative Editing](./COLLABORATIVE_EDITING.md)
