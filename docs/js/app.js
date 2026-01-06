/**
 * TSN Switch Manager - Web Serial App
 */

const App = {
  serial: null,
  isConnected: false,
  currentConfig: null,

  init() {
    this.serial = new SerialManager();

    // Check Web Serial support
    if (!SerialManager.isSupported()) {
      this.showError('Web Serial API not supported. Please use Chrome or Edge browser.');
      document.getElementById('connect-btn').disabled = true;
      return;
    }

    // Event listeners
    this.serial.addEventListener('connected', () => this.onConnected());
    this.serial.addEventListener('disconnected', () => this.onDisconnected());
    this.serial.addEventListener('ready', () => this.onBoardReady());
    this.serial.addEventListener('error', (e) => this.onError(e.detail));

    // UI event listeners
    document.getElementById('connect-btn').addEventListener('click', () => this.toggleConnection());
    document.getElementById('refresh-btn').addEventListener('click', () => this.refreshData());

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => this.navigateTo(item.dataset.page));
    });

    this.updateStatus('Ready');
  },

  async toggleConnection() {
    const btn = document.getElementById('connect-btn');

    if (this.isConnected) {
      btn.textContent = 'Disconnecting...';
      btn.disabled = true;
      await this.serial.disconnect();
      btn.disabled = false;
    } else {
      try {
        btn.textContent = 'Connecting...';
        btn.disabled = true;
        await this.serial.connect();
      } catch (error) {
        this.showError('Connection failed: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    }
  },

  onConnected() {
    this.isConnected = true;
    document.getElementById('connect-btn').textContent = 'Waiting...';
    document.getElementById('status-indicator').classList.remove('on');
    this.updateStatus('Initializing...');
  },

  onDisconnected() {
    this.isConnected = false;
    this.serial.boardReady = false;
    document.getElementById('connect-btn').textContent = 'Connect';
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('status-indicator').classList.remove('on');
    this.updateStatus('Disconnected');
    this.clearData();
  },

  async onBoardReady() {
    document.getElementById('connect-btn').textContent = 'Disconnect';
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('status-indicator').classList.add('on');
    this.updateStatus('Connected');

    // Load initial data
    await this.refreshData();
  },

  onError(error) {
    console.error('Serial error:', error);
    this.showError(error.message || 'Serial error');
  },

  async refreshData() {
    if (!this.serial.boardReady) return;

    try {
      this.updateStatus('Loading...');
      const cborData = await this.serial.sendGetRequest();

      // Decode CBOR (cbor-js expects ArrayBuffer)
      const rawConfig = CBOR.decode(cborData.buffer.slice(cborData.byteOffset, cborData.byteOffset + cborData.byteLength));

      // Transform delta-SID encoded data to YANG names
      const config = this.detransform(rawConfig);
      this.currentConfig = config;

      this.displayConfig(config);
      this.updateStatus('Connected');
    } catch (error) {
      console.error('Refresh failed:', error);
      this.showError('Failed to load config: ' + error.message);
      this.updateStatus('Error');
    }
  },

  /**
   * Transform delta-SID encoded CBOR to YANG structure
   */
  detransform(data, parentSid = 0) {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map(item => this.detransform(item, parentSid));
    }

    if (typeof data === 'object') {
      const result = {};

      for (const [key, value] of Object.entries(data)) {
        const deltaSid = parseInt(key, 10);

        if (!isNaN(deltaSid)) {
          // This is a delta-SID key
          const absoluteSid = parentSid + deltaSid;
          const sidInfo = SID_MAP.map[absoluteSid];

          if (sidInfo) {
            // Extract the leaf name from the full path
            const yangName = this.extractLeafName(sidInfo.path);
            result[yangName] = this.detransform(value, absoluteSid);
          } else {
            // Unknown SID, keep the number
            result[key] = this.detransform(value, absoluteSid);
          }
        } else {
          // Regular string key
          result[key] = this.detransform(value, parentSid);
        }
      }

      return result;
    }

    return data;
  },

  /**
   * Extract leaf name from YANG path
   * e.g., "/ietf-interfaces:interfaces/interface/name" -> "name"
   */
  extractLeafName(path) {
    if (!path) return path;

    // Remove leading slash
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;

    // Split by / and get last part
    const parts = cleanPath.split('/');
    let lastPart = parts[parts.length - 1];

    // Handle module prefix (e.g., "ietf-interfaces:interfaces" -> "ietf-interfaces:interfaces")
    // For root elements, keep the full name with module prefix
    if (parts.length === 1) {
      return lastPart;
    }

    // For nested elements, just use the leaf name
    return lastPart;
  },

  displayConfig(config) {
    // System info (look for ietf-hardware:hardware)
    const hardware = config['ietf-hardware:hardware'] || config['hardware'];
    if (hardware && hardware.component) {
      const chassis = hardware.component.find(c =>
        c.class === 'iana-hardware:chassis' || c.class === 'chassis'
      );
      if (chassis) {
        this.setText('sys-model', chassis['model-name'] || '--');
        this.setText('sys-firmware', chassis['firmware-rev'] || '--');
        this.setText('sys-serial', chassis['serial-num'] || '--');
      }

      const tempSensor = hardware.component.find(c => c.name === 'SwTmp');
      if (tempSensor && tempSensor['sensor-data']) {
        const temp = tempSensor['sensor-data'].value;
        this.setText('sys-temp', temp ? `${temp}°C` : '--');
      }
    }

    // Interfaces
    const interfaces = config['ietf-interfaces:interfaces'] || config['interfaces'];
    if (interfaces && interfaces.interface) {
      this.updatePorts(interfaces.interface);
    }

    // Show raw config in config tab
    this.displayRawConfig(config);
  },

  updatePorts(interfaces) {
    interfaces.forEach((iface, index) => {
      const portNum = index + 1;
      if (portNum > 2) return;

      const prefix = `port${portNum}`;
      const isUp = iface['oper-status'] === 'up';

      // Status badge
      const statusBadge = document.getElementById(`${prefix}-status`);
      if (statusBadge) {
        statusBadge.textContent = isUp ? 'UP' : 'DOWN';
        statusBadge.className = `port-badge ${isUp ? 'up' : 'down'}`;
      }

      // LEDs
      const linkLed = document.getElementById(`${prefix}-link-led`);
      if (linkLed) {
        linkLed.classList.toggle('active', isUp);
      }

      // Stats
      const stats = iface.statistics || {};
      const rxPackets = (stats['in-unicast-pkts'] || 0) +
                        (stats['in-multicast-pkts'] || 0) +
                        (stats['in-broadcast-pkts'] || 0);
      const txPackets = (stats['out-unicast-pkts'] || 0) +
                        (stats['out-multicast-pkts'] || 0) +
                        (stats['out-broadcast-pkts'] || 0);

      this.setText(`${prefix}-rx`, this.formatNumber(rxPackets));
      this.setText(`${prefix}-tx`, this.formatNumber(txPackets));
      this.setText(`${prefix}-rx-bytes`, this.formatBytes(stats['in-octets'] || 0));
      this.setText(`${prefix}-tx-bytes`, this.formatBytes(stats['out-octets'] || 0));
      this.setText(`${prefix}-errors`, this.formatNumber((stats['in-errors'] || 0) + (stats['out-errors'] || 0)));
      this.setText(`${prefix}-discards`, this.formatNumber((stats['in-discards'] || 0) + (stats['out-discards'] || 0)));

      // MAC address
      if (index === 0 && iface['phys-address']) {
        this.setText('sys-mac', iface['phys-address']);
      }
    });

    // Update ports table
    this.updatePortsTable(interfaces);
  },

  updatePortsTable(interfaces) {
    const tbody = document.getElementById('ports-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    interfaces.forEach((iface, index) => {
      const portNum = index + 1;
      const isUp = iface['oper-status'] === 'up';
      const ethernet = iface.ethernet || {};
      const speed = ethernet.speed || 1;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${portNum}</td>
        <td><span class="status-badge ${isUp ? 'up' : 'down'}">${isUp ? 'UP' : 'DOWN'}</span></td>
        <td>${speed}G</td>
        <td>${iface['phys-address'] || '--'}</td>
        <td>1</td>
        <td>${iface.type || 'ethernetCsmacd'}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  displayRawConfig(data) {
    const configContent = document.getElementById('config-content');
    if (configContent) {
      try {
        const yaml = jsyaml.dump(data, { indent: 2, lineWidth: -1 });
        configContent.textContent = yaml;
      } catch (e) {
        configContent.textContent = JSON.stringify(data, null, 2);
      }
    }
  },

  clearData() {
    this.currentConfig = null;
    ['sys-model', 'sys-firmware', 'sys-serial', 'sys-temp', 'sys-mac'].forEach(id => {
      this.setText(id, '--');
    });

    for (let i = 1; i <= 2; i++) {
      const prefix = `port${i}`;
      const statusBadge = document.getElementById(`${prefix}-status`);
      if (statusBadge) {
        statusBadge.textContent = 'DOWN';
        statusBadge.className = 'port-badge down';
      }
      const linkLed = document.getElementById(`${prefix}-link-led`);
      if (linkLed) linkLed.classList.remove('active');

      ['rx', 'tx', 'rx-bytes', 'tx-bytes', 'errors', 'discards'].forEach(stat => {
        this.setText(`${prefix}-${stat}`, '0');
      });
    }

    const tbody = document.getElementById('ports-table-body');
    if (tbody) tbody.innerHTML = '';

    const configContent = document.getElementById('config-content');
    if (configContent) configContent.textContent = '';
  },

  navigateTo(page) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `${page}-page`);
    });

    const titles = {
      dashboard: 'Dashboard',
      ports: 'Ports',
      config: 'Configuration'
    };

    document.getElementById('page-title').textContent = titles[page] || page;
  },

  // Utility functions
  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  },

  formatNumber(num) {
    if (typeof num !== 'number') return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'G';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  },

  formatBytes(bytes) {
    if (typeof bytes !== 'number') return '0 B';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  },

  updateStatus(text) {
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.textContent = text;
  },

  showError(message) {
    alert(message);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
