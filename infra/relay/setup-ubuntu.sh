#!/bin/bash
#
# OpenAgents Relay Server - Ubuntu Setup Script
#
# This script sets up the relay server on Ubuntu without Docker.
# It installs Node.js, configures the service, and sets up systemd.
#
# Usage:
#   chmod +x setup-ubuntu.sh
#   sudo ./setup-ubuntu.sh
#
# Options:
#   --with-nginx    Also configure nginx (HTTP only, assumes Cloudflare handles SSL)
#   --domain NAME   Domain name (default: relay.openagents.org)
#   --port PORT     Port for the relay service (default: 3000)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default configuration
RELAY_USER="openagents-relay"
RELAY_DIR="/opt/openagents-relay"
RELAY_PORT=3000
DOMAIN="relay.openagents.org"
SETUP_NGINX=false
NODE_VERSION="20"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --with-nginx)
            SETUP_NGINX=true
            shift
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --port)
            RELAY_PORT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --with-nginx    Also configure nginx (HTTP only, Cloudflare handles SSL)"
            echo "  --domain NAME   Domain name (default: relay.openagents.org)"
            echo "  --port PORT     Port for relay service (default: 3000)"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}This script must be run as root (use sudo)${NC}"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OpenAgents Relay Server Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Configuration:"
echo "  Install directory: $RELAY_DIR"
echo "  Service port: $RELAY_PORT"
echo "  Setup nginx: $SETUP_NGINX"
if $SETUP_NGINX; then
    echo "  Domain: $DOMAIN"
fi
echo ""

# Confirm before proceeding
read -p "Continue with installation? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}[1/7] Updating system packages...${NC}"
apt-get update -qq

echo -e "${YELLOW}[2/7] Installing dependencies...${NC}"
apt-get install -y -qq curl wget gnupg2 ca-certificates lsb-release

# Check if Node.js is installed
if command -v node &> /dev/null; then
    CURRENT_NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $CURRENT_NODE_VERSION -ge 18 ]]; then
        echo -e "${GREEN}Node.js v$(node -v) is already installed${NC}"
    else
        echo -e "${YELLOW}Node.js version is too old, installing Node.js $NODE_VERSION...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
        apt-get install -y -qq nodejs
    fi
else
    echo -e "${YELLOW}[3/7] Installing Node.js $NODE_VERSION...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y -qq nodejs
fi

echo -e "${GREEN}Node.js $(node -v) installed${NC}"
echo -e "${GREEN}npm $(npm -v) installed${NC}"

echo -e "${YELLOW}[4/7] Creating relay user and directory...${NC}"

# Create system user if it doesn't exist
if ! id "$RELAY_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false "$RELAY_USER"
    echo -e "${GREEN}Created system user: $RELAY_USER${NC}"
else
    echo -e "${GREEN}User $RELAY_USER already exists${NC}"
fi

# Create installation directory
mkdir -p "$RELAY_DIR"

# Copy relay files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
    echo "Copying relay files from $SCRIPT_DIR..."
    cp "$SCRIPT_DIR/package.json" "$RELAY_DIR/"
    cp -r "$SCRIPT_DIR/src" "$RELAY_DIR/"
else
    echo -e "${YELLOW}Creating relay files...${NC}"

    # Create package.json
    cat > "$RELAY_DIR/package.json" << 'PKGJSON'
{
  "name": "openagents-relay",
  "version": "1.0.0",
  "description": "WebSocket relay server for OpenAgents localhost networks",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "uuid": "^9.0.0",
    "cors": "^2.8.5"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
PKGJSON

    # Create src directory and server.js
    mkdir -p "$RELAY_DIR/src"

    cat > "$RELAY_DIR/src/server.js" << 'SERVERJS'
/**
 * OpenAgents Relay Server
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30000;
const REQUEST_TIMEOUT = 30000;

const networks = new Map();
const pendingRequests = new Map();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connectedNetworks: networks.size,
    uptime: process.uptime(),
  });
});

app.get('/networks', (req, res) => {
  const networkList = [];
  for (const [id, data] of networks.entries()) {
    networkList.push({
      id,
      name: data.info?.name || id,
      connectedAt: data.connectedAt,
      lastHeartbeat: data.lastHeartbeat,
    });
  }
  res.json({ networks: networkList });
});

app.get('/networks/:networkId/status', (req, res) => {
  const { networkId } = req.params;
  const network = networks.get(networkId);

  if (!network) {
    return res.status(404).json({ error: 'Network not connected', online: false });
  }

  res.json({
    online: true,
    id: networkId,
    name: network.info?.name || networkId,
    connectedAt: network.connectedAt,
    lastHeartbeat: network.lastHeartbeat,
  });
});

app.all('/network/:networkId/*', async (req, res) => {
  const { networkId } = req.params;
  const network = networks.get(networkId);

  if (!network) {
    return res.status(503).json({
      error: 'Network not connected to relay',
      code: 'NETWORK_OFFLINE',
    });
  }

  if (network.ws.readyState !== WebSocket.OPEN) {
    networks.delete(networkId);
    return res.status(503).json({
      error: 'Network connection lost',
      code: 'CONNECTION_LOST',
    });
  }

  const path = req.params[0] || '';
  const requestId = uuidv4();

  const wsRequest = {
    type: 'http_request',
    requestId,
    method: req.method,
    path: '/' + path,
    query: req.query,
    headers: sanitizeHeaders(req.headers),
    body: getRequestBody(req),
  };

  try {
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, REQUEST_TIMEOUT);

      pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    network.ws.send(JSON.stringify(wsRequest));

    const wsResponse = await responsePromise;

    res.status(wsResponse.status || 200);

    if (wsResponse.headers) {
      for (const [key, value] of Object.entries(wsResponse.headers)) {
        if (!isHopByHopHeader(key)) {
          res.set(key, value);
        }
      }
    }

    if (wsResponse.body) {
      if (typeof wsResponse.body === 'string') {
        res.send(wsResponse.body);
      } else {
        res.json(wsResponse.body);
      }
    } else {
      res.end();
    }

  } catch (error) {
    console.error(`Request ${requestId} failed:`, error.message);
    res.status(504).json({
      error: error.message,
      code: 'RELAY_ERROR',
    });
  }
});

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);

  let networkId = null;

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    if (networkId && networks.has(networkId)) {
      networks.get(networkId).lastHeartbeat = Date.now();
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'register':
          handleRegister(ws, message, req);
          break;
        case 'http_response':
          handleHttpResponse(message);
          break;
        case 'heartbeat':
          handleHeartbeat(ws, networkId);
          break;
        case 'unregister':
          handleUnregister(networkId);
          ws.close();
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed for network:', networkId);
    if (networkId) networks.delete(networkId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error for network:', networkId, error.message);
    if (networkId) networks.delete(networkId);
  });

  function handleRegister(ws, message, req) {
    const { network_id, token, info } = message;

    if (!network_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'network_id is required' }));
      return;
    }

    if (networks.has(network_id)) {
      const existing = networks.get(network_id);
      if (existing.token && existing.token !== token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Network ID already in use' }));
        return;
      }
      existing.ws.close();
    }

    const managementToken = token || uuidv4();
    networkId = network_id;

    networks.set(network_id, {
      ws,
      token: managementToken,
      info: info || {},
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    console.log(`Network registered: ${network_id}`);

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;

    ws.send(JSON.stringify({
      type: 'registered',
      network_id,
      token: managementToken,
      relay_url: `${protocol}://${host}/network/${network_id}`,
    }));
  }

  function handleHttpResponse(message) {
    const { requestId, status, headers, body } = message;
    const pending = pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      pending.resolve({ status, headers, body });
    }
  }

  function handleHeartbeat(ws, networkId) {
    if (networkId && networks.has(networkId)) {
      networks.get(networkId).lastHeartbeat = Date.now();
    }
    ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
  }

  function handleUnregister(networkId) {
    if (networkId) {
      networks.delete(networkId);
      console.log(`Network unregistered: ${networkId}`);
    }
  }
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeatInterval));

function sanitizeHeaders(headers) {
  const sanitized = {};
  const skipHeaders = ['host', 'connection', 'upgrade', 'keep-alive', 'transfer-encoding'];
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function getRequestBody(req) {
  if (req.body && Object.keys(req.body).length > 0) return req.body;
  return null;
}

function isHopByHopHeader(header) {
  const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'];
  return hopByHop.includes(header.toLowerCase());
}

server.listen(PORT, () => {
  console.log(`OpenAgents Relay Server running on port ${PORT}`);
});
SERVERJS
fi

echo -e "${YELLOW}[5/7] Installing npm dependencies...${NC}"
cd "$RELAY_DIR"
npm install --production --quiet

# Set ownership
chown -R "$RELAY_USER:$RELAY_USER" "$RELAY_DIR"

echo -e "${YELLOW}[6/7] Creating systemd service...${NC}"

cat > /etc/systemd/system/openagents-relay.service << EOF
[Unit]
Description=OpenAgents Relay Server
Documentation=https://docs.openagents.org/relay
After=network.target

[Service]
Type=simple
User=$RELAY_USER
Group=$RELAY_USER
WorkingDirectory=$RELAY_DIR
Environment=NODE_ENV=production
Environment=PORT=$RELAY_PORT
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$RELAY_DIR

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openagents-relay

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable openagents-relay
systemctl start openagents-relay

echo -e "${GREEN}Relay service started!${NC}"

# Setup nginx if requested
if $SETUP_NGINX; then
    echo -e "${YELLOW}[7/7] Setting up nginx (HTTP only, Cloudflare handles SSL)...${NC}"

    # Install nginx only (no certbot needed - Cloudflare handles SSL)
    apt-get install -y -qq nginx

    # Create nginx config - HTTP only, Cloudflare terminates SSL
    cat > /etc/nginx/sites-available/openagents-relay << EOF
# OpenAgents Relay - HTTP only (Cloudflare handles SSL termination)
upstream relay_backend {
    server 127.0.0.1:$RELAY_PORT;
    keepalive 64;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 10m;

    # Trust Cloudflare headers for real client IP
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    real_ip_header CF-Connecting-IP;

    location /health {
        proxy_pass http://relay_backend/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host \$host;
    }

    location /networks {
        proxy_pass http://relay_backend/networks;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host \$host;

        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
    }

    # WebSocket endpoint for local networks to register
    location /register {
        proxy_pass http://relay_backend/register;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    # HTTP proxy to networks
    location /network/ {
        proxy_pass http://relay_backend/network/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, PATCH, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Request-ID' always;

        if (\$request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*';
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Request-ID';
            add_header 'Access-Control-Max-Age' 86400;
            return 204;
        }
    }

    location / {
        default_type application/json;
        return 200 '{"service": "OpenAgents Relay", "docs": "https://docs.openagents.org/relay"}';
    }
}
EOF

    # Enable the site
    ln -sf /etc/nginx/sites-available/openagents-relay /etc/nginx/sites-enabled/

    # Remove default site if it exists
    rm -f /etc/nginx/sites-enabled/default

    # Test nginx config
    nginx -t

    # Reload nginx
    systemctl reload nginx

    echo -e "${GREEN}Nginx configured!${NC}"
    echo ""
    echo -e "${YELLOW}Note: SSL is handled by Cloudflare. Make sure to:${NC}"
    echo "  1. Add $DOMAIN to Cloudflare"
    echo "  2. Set SSL/TLS mode to 'Flexible' or 'Full' in Cloudflare dashboard"
    echo "  3. Enable WebSocket support in Cloudflare (Network > WebSockets)"
else
    echo -e "${YELLOW}[7/7] Skipping nginx setup (use --with-nginx to enable)${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Relay service status:"
systemctl status openagents-relay --no-pager -l | head -20
echo ""
echo "Useful commands:"
echo "  View logs:        sudo journalctl -u openagents-relay -f"
echo "  Restart service:  sudo systemctl restart openagents-relay"
echo "  Stop service:     sudo systemctl stop openagents-relay"
echo "  Check status:     sudo systemctl status openagents-relay"
echo ""
echo "Test the relay:"
echo "  curl http://localhost:$RELAY_PORT/health"
if $SETUP_NGINX; then
    echo "  curl http://$DOMAIN/health  (or https:// via Cloudflare)"
fi
echo ""
echo -e "${GREEN}Done!${NC}"
