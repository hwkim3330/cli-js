/**
 * API Routes for TSN Switch Web UI
 */

import { Router } from 'express';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC2CBOR_LIB = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor/lib')).href;
const TSC2CBOR = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor')).href;

/**
 * Device Manager - Singleton for serial connection
 */
export class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.serialManager = null;
    this.yangCatalog = null;
    this.converter = null;
    this.currentConfig = null;
    this.connected = false;
    this.boardReady = false;
  }

  async init() {
    const { SerialManager } = await import(`${TSC2CBOR_LIB}/serial/serial.js`);
    const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);

    this.serialManager = new SerialManager();
    this.yangCatalog = new YangCatalogManager();

    // Setup event forwarding
    this.serialManager.on('announce', () => {
      this.boardReady = true;
      this.emit('boardReady');
    });
  }

  async listPorts() {
    const { SerialManager } = await import(`${TSC2CBOR_LIB}/serial/serial.js`);
    return await SerialManager.listPorts();
  }

  async connect(port) {
    if (!this.serialManager) {
      await this.init();
    }

    await this.serialManager.connect(port);
    this.connected = true;
    this.boardReady = false;

    // Wait for board ready
    await this.waitForBoardReady(10000);

    this.emit('connected');
    return true;
  }

  waitForBoardReady(timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (this.serialManager.boardReady) {
        this.boardReady = true;
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for board ANNOUNCE'));
      }, timeout);

      const check = () => {
        if (this.serialManager.boardReady) {
          this.boardReady = true;
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async disconnect() {
    if (this.serialManager && this.connected) {
      await this.serialManager.disconnect();
      this.connected = false;
      this.boardReady = false;
      this.emit('disconnected');
    }
  }

  isConnected() {
    return this.connected;
  }

  isBoardReady() {
    return this.boardReady;
  }

  async getConfig() {
    if (!this.connected || !this.boardReady) {
      throw new Error('Device not connected or not ready');
    }

    const { Cbor2TscConverter } = await import(`${TSC2CBOR}/cbor2tsc.js`);

    const response = await this.serialManager.sendGetRequest();
    if (!response.isSuccess()) {
      throw new Error(`GET failed: CoAP code ${response.code}`);
    }

    const catalogs = this.yangCatalog.listCachedCatalogs();
    if (catalogs.length === 0) {
      throw new Error('No YANG catalog found');
    }

    const converter = new Cbor2TscConverter(catalogs[0].path);
    const result = await converter.convertBuffer(response.payload, {
      outputFormat: 'rfc7951'
    });

    // Parse YAML to JSON
    const yaml = await import('js-yaml');
    this.currentConfig = yaml.default.load(result.yaml);
    this.currentYaml = result.yaml;

    return { config: this.currentConfig, yaml: result.yaml };
  }

  async patchConfig(patchYaml) {
    if (!this.connected || !this.boardReady) {
      throw new Error('Device not connected or not ready');
    }

    const { Tsc2CborConverter } = await import(`${TSC2CBOR}/tsc2cbor.js`);

    const catalogs = this.yangCatalog.listCachedCatalogs();
    if (catalogs.length === 0) {
      throw new Error('No YANG catalog found');
    }

    const converter = new Tsc2CborConverter(catalogs[0].path);
    const result = await converter.convertYaml(patchYaml, {
      compatible: true,
      sortMode: 'velocity'
    });

    const response = await this.serialManager.sendiPatchRequest(result.cbor, {
      blockSize: 6
    });

    return {
      success: response.isSuccess(),
      code: response.code
    };
  }

  getCatalogs() {
    if (!this.yangCatalog) {
      const { YangCatalogManager } = import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);
      this.yangCatalog = new YangCatalogManager();
    }
    return this.yangCatalog.listCachedCatalogs();
  }
}

/**
 * Create Express Router
 */
export function createApiRouter(deviceManager) {
  const router = Router();

  // List serial ports
  router.get('/ports', async (req, res) => {
    try {
      const ports = await deviceManager.listPorts();
      res.json({ success: true, ports });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Connect to device
  router.post('/connect', async (req, res) => {
    try {
      const { port } = req.body;
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }
      await deviceManager.connect(port);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Disconnect from device
  router.post('/disconnect', async (req, res) => {
    try {
      await deviceManager.disconnect();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get connection status
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      connected: deviceManager.isConnected(),
      boardReady: deviceManager.isBoardReady()
    });
  });

  // Get full configuration
  router.get('/config', async (req, res) => {
    try {
      const result = await deviceManager.getConfig();
      res.json({ success: true, config: result.config, yaml: result.yaml });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Patch configuration
  router.post('/config', async (req, res) => {
    try {
      const { yaml } = req.body;
      if (!yaml) {
        return res.status(400).json({ success: false, error: 'YAML patch is required' });
      }
      const result = await deviceManager.patchConfig(yaml);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get YANG catalogs
  router.get('/yang/catalogs', async (req, res) => {
    try {
      const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);
      const yangCatalog = new YangCatalogManager();
      const catalogs = yangCatalog.listCachedCatalogs();
      res.json({ success: true, catalogs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
