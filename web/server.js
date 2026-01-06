/**
 * TSN Switch Web UI Server
 *
 * Express + WebSocket server for keti-tsn-cli web interface
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter, DeviceManager } from './lib/api-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
const deviceManager = new DeviceManager();
app.use('/api', createApiRouter(deviceManager));

// WebSocket handling
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});

// Broadcast to all clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// Periodic stats update (every 5 seconds)
let statsInterval = null;
let statsFetching = false; // Prevent concurrent requests

deviceManager.on('connected', () => {
  console.log('Device connected, starting stats broadcast');
  broadcast({ type: 'status', data: { connected: true, boardReady: deviceManager.isBoardReady() } });

  // Start periodic stats
  if (!statsInterval) {
    statsInterval = setInterval(async () => {
      // Skip if already fetching or not ready
      if (statsFetching || !deviceManager.isConnected() || !deviceManager.isBoardReady()) {
        return;
      }

      statsFetching = true;
      try {
        const result = await deviceManager.getConfig();
        broadcast({ type: 'stats', data: extractStats(result.config) });
      } catch (err) {
        console.error('Stats fetch error:', err.message);
      } finally {
        statsFetching = false;
      }
    }, 5000); // Increased to 5 seconds
  }
});

deviceManager.on('disconnected', () => {
  console.log('Device disconnected');
  broadcast({ type: 'status', data: { connected: false, boardReady: false } });

  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
});

deviceManager.on('boardReady', () => {
  broadcast({ type: 'status', data: { connected: true, boardReady: true } });
});

// Extract stats from config for monitoring
function extractStats(config) {
  const stats = {
    timestamp: Date.now(),
    ports: [],
    system: {}
  };

  try {
    // Extract interface stats
    const interfaces = config?.['ietf-interfaces:interfaces']?.interface || [];
    interfaces.forEach(iface => {
      const portStats = {
        name: iface.name,
        status: iface['oper-status'],
        mac: iface['phys-address'],
        rxPackets: (iface.statistics?.['in-unicast-pkts'] || 0) +
                   (iface.statistics?.['in-multicast-pkts'] || 0) +
                   (iface.statistics?.['in-broadcast-pkts'] || 0),
        txPackets: (iface.statistics?.['out-unicast-pkts'] || 0) +
                   (iface.statistics?.['out-multicast-pkts'] || 0) +
                   (iface.statistics?.['out-broadcast-pkts'] || 0),
        rxBytes: iface.statistics?.['in-octets'] || 0,
        txBytes: iface.statistics?.['out-octets'] || 0,
        errors: (iface.statistics?.['in-errors'] || 0) + (iface.statistics?.['out-errors'] || 0),
        discards: (iface.statistics?.['in-discards'] || 0) + (iface.statistics?.['out-discards'] || 0)
      };
      stats.ports.push(portStats);
    });

    // Extract hardware info
    const hardware = config?.['ietf-hardware:hardware']?.component || [];
    const tempSensor = hardware.find(c => c.class === 'sensor' && c.name === 'SwTmp');
    if (tempSensor) {
      stats.system.temperature = tempSensor['sensor-data']?.value || 0;
    }

    const board = hardware.find(c => c.class === 'chassis');
    if (board) {
      stats.system.model = board['model-name'];
      stats.system.firmware = board['firmware-rev'];
      stats.system.serial = board['serial-num'];
    }
  } catch (err) {
    console.error('Stats extraction error:', err.message);
  }

  return stats;
}

// Start server
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     TSN Switch Web UI                        ║
║     http://localhost:${PORT}                     ║
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (deviceManager.isConnected()) {
    await deviceManager.disconnect();
  }
  server.close();
  process.exit(0);
});
