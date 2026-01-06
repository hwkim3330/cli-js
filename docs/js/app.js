/**
 * TSN Switch Manager - Web Serial App
 */

const App = {
  serial: null,
  isConnected: false,
  currentConfig: null,
  interfaces: [],

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

    // Setup tabs
    this.setupTabs();

    // Setup config copy button
    document.getElementById('config-copy-btn')?.addEventListener('click', () => {
      const content = document.getElementById('config-content')?.textContent;
      if (content) {
        navigator.clipboard.writeText(content);
        this.showMessage('Copied to clipboard!');
      }
    });

    // Apply buttons
    document.getElementById('pcp-apply-btn')?.addEventListener('click', () => this.applyPCPMapping());
    document.getElementById('queue-apply-btn')?.addEventListener('click', () => this.applyQueueConfig());
    document.getElementById('shaper-apply-btn')?.addEventListener('click', () => this.applyShaperConfig());
    document.getElementById('tas-apply-btn')?.addEventListener('click', () => this.applyTASConfig());
    document.getElementById('port-apply-btn')?.addEventListener('click', () => this.applyPortConfig());
    document.getElementById('port-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('port-detail-card').style.display = 'none';
    });

    this.updateStatus('Ready');
  },

  setupTabs() {
    document.querySelectorAll('.tabs').forEach(tabContainer => {
      tabContainer.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const tabId = tab.dataset.tab;

          // Update tab buttons
          tabContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          // Update tab content
          const page = tabContainer.closest('.page');
          page.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId);
          });
        });
      });
    });
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

      const rawConfig = CBOR.decode(cborData.buffer.slice(cborData.byteOffset, cborData.byteOffset + cborData.byteLength));
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
          const absoluteSid = parentSid + deltaSid;
          const sidInfo = SID_MAP.map[absoluteSid];

          if (sidInfo) {
            const yangName = this.extractLeafName(sidInfo.path);
            result[yangName] = this.detransform(value, absoluteSid);
          } else {
            result[key] = this.detransform(value, absoluteSid);
          }
        } else {
          result[key] = this.detransform(value, parentSid);
        }
      }

      return result;
    }

    return data;
  },

  extractLeafName(path) {
    if (!path) return path;
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const parts = cleanPath.split('/');
    return parts[parts.length - 1];
  },

  displayConfig(config) {
    // System info
    const hardware = config['ietf-hardware:hardware'] || config['hardware'];
    if (hardware && hardware.component) {
      const chassis = hardware.component.find(c =>
        c.class === 'iana-hardware:chassis' || c.class === 'chassis' || c.class === 31003
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
      this.interfaces = interfaces.interface;
      this.updatePorts(interfaces.interface);
    }

    this.displayRawConfig(config);
  },

  updatePorts(interfaces) {
    interfaces.forEach((iface, index) => {
      const portNum = index + 1;
      if (portNum > 2) return;

      const prefix = `port${portNum}`;
      const isUp = iface['oper-status'] === 'up';

      const statusBadge = document.getElementById(`${prefix}-status`);
      if (statusBadge) {
        statusBadge.textContent = isUp ? 'UP' : 'DOWN';
        statusBadge.className = `port-badge ${isUp ? 'up' : 'down'}`;
      }

      const linkLed = document.getElementById(`${prefix}-link-led`);
      if (linkLed) {
        linkLed.classList.toggle('active', isUp);
      }

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

      if (index === 0 && iface['phys-address']) {
        this.setText('sys-mac', iface['phys-address']);
      }
    });

    this.updatePortsTable(interfaces);
  },

  updatePortsTable(interfaces) {
    const tbody = document.getElementById('ports-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    interfaces.forEach((iface, index) => {
      const portNum = index + 1;
      const isUp = iface['oper-status'] === 'up';
      const adminUp = iface.enabled !== false;
      const ethernet = iface.ethernet || {};
      const speed = ethernet.speed || '1G';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${portNum}</td>
        <td><span class="status-badge ${isUp ? 'up' : 'down'}">${isUp ? 'UP' : 'DOWN'}</span></td>
        <td><span class="status-badge ${adminUp ? 'up' : 'down'}">${adminUp ? 'ON' : 'OFF'}</span></td>
        <td>${speed}</td>
        <td>Full</td>
        <td>${iface['phys-address'] || '--'}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="App.editPort(${portNum})">Edit</button></td>
      `;
      tbody.appendChild(tr);
    });
  },

  editPort(portNum) {
    const card = document.getElementById('port-detail-card');
    if (card) {
      card.style.display = 'block';
      document.getElementById('port-detail-num').textContent = portNum;

      const iface = this.interfaces[portNum - 1];
      if (iface) {
        document.getElementById('port-admin-status').value = iface.enabled !== false ? 'up' : 'down';
      }
    }
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
    this.interfaces = [];
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
      ports: 'Port Configuration',
      qos: 'QoS Settings',
      scheduler: 'TAS Scheduler',
      config: 'Raw Configuration'
    };

    document.getElementById('page-title').textContent = titles[page] || page;
  },

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
  },

  showMessage(message) {
    alert(message);
  },

  // ========== iPATCH Methods ==========

  async applyPortConfig() {
    if (!this.serial.boardReady) {
      this.showError('Not connected');
      return;
    }

    const portNum = document.getElementById('port-detail-num').textContent;
    const adminStatus = document.getElementById('port-admin-status').value;
    const enabled = adminStatus === 'up';

    const iface = this.interfaces[parseInt(portNum) - 1];
    if (!iface) {
      this.showError('Interface not found');
      return;
    }

    const interfaceName = iface.name || `eth${portNum}`;

    try {
      this.updateStatus('Applying...');
      const patch = SIDTransformer.buildInterfacePatch(interfaceName, enabled);
      console.log('Port patch:', JSON.stringify(patch));

      await this.serial.sendIPatchRequest(patch);
      this.showMessage(`Port ${portNum} ${enabled ? 'enabled' : 'disabled'}`);
      document.getElementById('port-detail-card').style.display = 'none';
      await this.refreshData();
    } catch (error) {
      console.error('Port config failed:', error);
      this.showError('Failed: ' + error.message);
      this.updateStatus('Error');
    }
  },

  async applyTASConfig() {
    if (!this.serial.boardReady) {
      this.showError('Not connected');
      return;
    }

    const portNum = document.getElementById('tas-port').value;
    const enabled = document.getElementById('tas-enabled').checked;
    const iface = this.interfaces[parseInt(portNum) - 1];

    if (!iface) {
      this.showError('Interface not found');
      return;
    }

    const interfaceName = iface.name || `eth${portNum}`;

    try {
      this.updateStatus('Applying TAS...');
      const patch = SIDTransformer.buildTASPatch(interfaceName, enabled);
      console.log('TAS patch:', JSON.stringify(patch));

      await this.serial.sendIPatchRequest(patch);
      this.showMessage(`TAS ${enabled ? 'enabled' : 'disabled'} on Port ${portNum}`);
      await this.refreshData();
    } catch (error) {
      console.error('TAS config failed:', error);
      this.showError('Failed: ' + error.message);
      this.updateStatus('Error');
    }
  },

  async applyPCPMapping() {
    if (!this.serial.boardReady) {
      this.showError('Not connected');
      return;
    }

    // Get PCP to Queue mapping from UI
    const priorityToQueue = [];
    for (let pcp = 0; pcp < 8; pcp++) {
      const select = document.querySelector(`.pcp-queue[data-pcp="${pcp}"]`);
      priorityToQueue.push(select ? parseInt(select.value, 10) : pcp);
    }

    try {
      this.updateStatus('Applying PCP mapping...');

      // Apply to both ports
      for (let portNum = 1; portNum <= 2; portNum++) {
        const iface = this.interfaces[portNum - 1];
        if (!iface) continue;

        const interfaceName = iface.name || `eth${portNum}`;
        const patch = SIDTransformer.buildTrafficClassPatch(interfaceName, priorityToQueue);
        console.log(`Port ${portNum} PCP patch:`, JSON.stringify(patch));

        await this.serial.sendIPatchRequest(patch);
      }

      this.showMessage('PCP mapping applied to all ports');
      await this.refreshData();
    } catch (error) {
      console.error('PCP mapping failed:', error);
      this.showError('Failed: ' + error.message);
      this.updateStatus('Error');
    }
  },

  async applyQueueConfig() {
    if (!this.serial.boardReady) {
      this.showError('Not connected');
      return;
    }

    // Queue configuration is typically tied to scheduler weights
    // For now, show message that it requires more complex setup
    this.showMessage('Queue scheduling weights - device specific implementation needed');
  },

  async applyShaperConfig() {
    if (!this.serial.boardReady) {
      this.showError('Not connected');
      return;
    }

    try {
      this.updateStatus('Applying shaper config...');

      // Get shaper values from UI
      for (let portNum = 1; portNum <= 2; portNum++) {
        const iface = this.interfaces[portNum - 1];
        if (!iface) continue;

        const interfaceName = iface.name || `eth${portNum}`;
        const egressRate = parseInt(document.getElementById(`port${portNum}-egress`)?.value || '1000', 10);
        const burstSize = parseInt(document.getElementById(`port${portNum}-burst`)?.value || '64', 10);

        // Convert Mbps to kbps, KB to bytes
        const cirKbps = egressRate * 1000;
        const cbsBytes = burstSize * 1024;

        // Apply shaper to all traffic classes (or just TC 7 for simplicity)
        const patch = SIDTransformer.buildQosShaperPatch(interfaceName, 7, cirKbps, cbsBytes);
        console.log(`Port ${portNum} shaper patch:`, JSON.stringify(patch));

        await this.serial.sendIPatchRequest(patch);
      }

      this.showMessage('Shaper config applied');
      await this.refreshData();
    } catch (error) {
      console.error('Shaper config failed:', error);
      this.showError('Failed: ' + error.message);
      this.updateStatus('Error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
