/**
 * OpenAgents Relay Server
 *
 * Enables localhost networks to be accessible via a public relay.
 *
 * Architecture:
 * 1. Local networks connect via WebSocket to /register
 * 2. Remote clients access networks via HTTP at /network/{networkId}/*
 * 3. The relay forwards HTTP requests over WebSocket and returns responses
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Store connected networks: networkId -> { ws, token, info, lastHeartbeat }
const networks = new Map();

// Store pending requests: requestId -> { resolve, reject, timeout }
const pendingRequests = new Map();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connectedNetworks: networks.size,
    uptime: process.uptime(),
  });
});

// List connected networks (public info only)
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

// Check if a specific network is connected
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

// Proxy requests to network
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

  // Extract the path after /network/{networkId}
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
    network.ws.send(JSON.stringify(wsRequest));

    // Wait for response
    const wsResponse = await responsePromise;

    // Send response back to client
    res.status(wsResponse.status || 200);

    // Set response headers
    if (wsResponse.headers) {
      for (const [key, value] of Object.entries(wsResponse.headers)) {
        // Skip hop-by-hop headers
        if (!isHopByHopHeader(key)) {
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
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);

  let networkId = null;
  let isAuthenticated = false;

  // Set up heartbeat
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
          handleRegister(ws, message);
          break;

        case 'http_response':
          handleHttpResponse(message);
          break;

        case 'heartbeat':
          handleHeartbeat(ws, message, networkId);
          break;

        case 'unregister':
          handleUnregister(networkId);
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
    console.log('WebSocket closed for network:', networkId);
    if (networkId) {
      networks.delete(networkId);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error for network:', networkId, error.message);
    if (networkId) {
      networks.delete(networkId);
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

    // Check if network_id is already connected
    if (networks.has(network_id)) {
      const existing = networks.get(network_id);
      // Allow reconnection with same token
      if (existing.token && existing.token !== token) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Network ID already in use',
        }));
        return;
      }
      // Close old connection
      existing.ws.close();
    }

    // Generate a token if not provided
    const managementToken = token || uuidv4();

    // Register the network
    networkId = network_id;
    isAuthenticated = true;
    networks.set(network_id, {
      ws,
      token: managementToken,
      info: info || {},
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    console.log(`Network registered: ${network_id}`);

    ws.send(JSON.stringify({
      type: 'registered',
      network_id,
      token: managementToken,
      relay_url: `${getBaseUrl(req)}/network/${network_id}`,
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

  function handleHeartbeat(ws, message, networkId) {
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

function getBaseUrl(req) {
  // Try to determine the public URL of the relay
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

// Start server
server.listen(PORT, () => {
  console.log(`OpenAgents Relay Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`HTTP proxy endpoint: http://localhost:${PORT}/network/{networkId}/*`);
});
