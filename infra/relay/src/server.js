/**
 * OpenAgents Relay Server
 *
 * Enables localhost networks to be accessible via a public relay.
 *
 * Architecture:
 * 1. Local networks connect via WebSocket to /register
 * 2. Server generates a random tunnel ID for each connection
 * 3. Remote clients access networks via HTTP at /{tunnelId}/*
 * 4. The relay forwards HTTP requests over WebSocket and returns responses
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds
const TUNNEL_ID_LENGTH = 12; // Length of random tunnel ID

// Store connected tunnels: tunnelId -> { ws, networkId, token, info, lastHeartbeat }
const tunnels = new Map();

// Store pending requests: requestId -> { resolve, reject, timeout }
const pendingRequests = new Map();

// Generate a random tunnel ID (URL-safe)
function generateTunnelId() {
  return crypto.randomBytes(TUNNEL_ID_LENGTH).toString('base64url').slice(0, TUNNEL_ID_LENGTH);
}

// Reserved paths that cannot be used as tunnel IDs
const RESERVED_PATHS = ['health', 'networks', 'register', 'api', 'admin', 'status'];

function isReservedPath(path) {
  return RESERVED_PATHS.includes(path.toLowerCase());
}

// CORS middleware - single source of truth for CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');

  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connectedTunnels: tunnels.size,
    uptime: process.uptime(),
  });
});

// List connected tunnels (public info only - no tunnel IDs for security)
app.get('/networks', (req, res) => {
  const tunnelList = [];
  for (const [tunnelId, data] of tunnels.entries()) {
    tunnelList.push({
      name: data.info?.name || data.networkId,
      networkId: data.networkId,
      connectedAt: data.connectedAt,
      lastHeartbeat: data.lastHeartbeat,
    });
  }
  res.json({ networks: tunnelList, count: tunnels.size });
});

// Check tunnel status by tunnel ID
app.get('/status/:tunnelId', (req, res) => {
  const { tunnelId } = req.params;
  const tunnel = tunnels.get(tunnelId);

  if (!tunnel) {
    return res.status(404).json({ error: 'Tunnel not found', online: false });
  }

  res.json({
    online: true,
    tunnelId,
    networkId: tunnel.networkId,
    name: tunnel.info?.name || tunnel.networkId,
    connectedAt: tunnel.connectedAt,
    lastHeartbeat: tunnel.lastHeartbeat,
  });
});

// Proxy requests to tunnel - matches /{tunnelId} and /{tunnelId}/*
app.all('/:tunnelId', handleTunnelRequest);
app.all('/:tunnelId/*', handleTunnelRequest);

async function handleTunnelRequest(req, res) {
  const { tunnelId } = req.params;

  // Skip reserved paths
  if (isReservedPath(tunnelId)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const tunnel = tunnels.get(tunnelId);

  if (!tunnel) {
    return res.status(503).json({
      error: 'Tunnel not found or network not connected',
      code: 'TUNNEL_NOT_FOUND',
    });
  }

  if (tunnel.ws.readyState !== WebSocket.OPEN) {
    tunnels.delete(tunnelId);
    return res.status(503).json({
      error: 'Network connection lost',
      code: 'CONNECTION_LOST',
    });
  }

  // Extract the path after /{tunnelId}
  const path = req.params[0] || '';
  const requestId = uuidv4();

  // Build the request object to send over WebSocket
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
    // Create a promise that will resolve when we get the response
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, REQUEST_TIMEOUT);

      pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    // Send request to local network
    tunnel.ws.send(JSON.stringify(wsRequest));

    // Wait for response
    const wsResponse = await responsePromise;

    // Send response back to client
    res.status(wsResponse.status || 200);

    // Set response headers (skip hop-by-hop and CORS headers since cors middleware handles CORS)
    if (wsResponse.headers) {
      for (const [key, value] of Object.entries(wsResponse.headers)) {
        if (!isHopByHopHeader(key) && !isCorsHeader(key)) {
          res.set(key, value);
        }
      }
    }

    // Send body
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
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);

  let tunnelId = null;
  let networkId = null;

  // Set up heartbeat
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    if (tunnelId && tunnels.has(tunnelId)) {
      tunnels.get(tunnelId).lastHeartbeat = Date.now();
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'register':
          handleRegister(ws, message);
          break;

        case 'http_response':
          handleHttpResponse(message);
          break;

        case 'heartbeat':
          handleHeartbeat(ws, message, tunnelId);
          break;

        case 'unregister':
          handleUnregister(tunnelId);
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type',
          }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed for tunnel:', tunnelId);
    if (tunnelId) {
      tunnels.delete(tunnelId);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error for tunnel:', tunnelId, error.message);
    if (tunnelId) {
      tunnels.delete(tunnelId);
    }
  });

  // Handler functions
  function handleRegister(ws, message) {
    const { network_id, token, info } = message;

    if (!network_id) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'network_id is required',
      }));
      return;
    }

    // Generate a unique tunnel ID
    tunnelId = generateTunnelId();

    // Ensure uniqueness (very unlikely to collide but just in case)
    while (tunnels.has(tunnelId) || isReservedPath(tunnelId)) {
      tunnelId = generateTunnelId();
    }

    networkId = network_id;

    // Generate a management token if not provided
    const managementToken = token || uuidv4();

    // Register the tunnel
    tunnels.set(tunnelId, {
      ws,
      networkId: network_id,
      token: managementToken,
      info: info || {},
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    console.log(`Tunnel created: ${tunnelId} for network: ${network_id}`);

    ws.send(JSON.stringify({
      type: 'registered',
      tunnel_id: tunnelId,
      network_id,
      token: managementToken,
      relay_url: `${getBaseUrl(req)}/${tunnelId}`,
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

  function handleHeartbeat(ws, message, tunnelId) {
    if (tunnelId && tunnels.has(tunnelId)) {
      tunnels.get(tunnelId).lastHeartbeat = Date.now();
    }
    ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
  }

  function handleUnregister(tunnelId) {
    if (tunnelId) {
      tunnels.delete(tunnelId);
      console.log(`Tunnel unregistered: ${tunnelId}`);
    }
    ws.close();
  }
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Utility functions
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
  if (req.body && Object.keys(req.body).length > 0) {
    return req.body;
  }
  return null;
}

function isHopByHopHeader(header) {
  const hopByHop = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade'
  ];
  return hopByHop.includes(header.toLowerCase());
}

function isCorsHeader(header) {
  const corsHeaders = [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
    'access-control-max-age',
  ];
  return corsHeaders.includes(header.toLowerCase());
}

function getBaseUrl(req) {
  // Try to determine the public URL of the relay
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

// Start server
server.listen(PORT, () => {
  console.log(`OpenAgents Relay Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/register`);
  console.log(`HTTP proxy endpoint: http://localhost:${PORT}/{tunnelId}/*`);
});
