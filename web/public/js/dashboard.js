/**
 * Dashboard Module - TSN Switch Manager
 */

const Dashboard = {
  init() {
    // Listen for stats updates
    wsClient.on('stats', (data) => this.updateStats(data));
    wsClient.on('status', (data) => this.updateConnectionStatus(data));
  },

  updateStats(stats) {
    if (!stats) return;

    // Update system info
    if (stats.system) {
      this.setText('sys-model', stats.system.model || '--');
      this.setText('sys-firmware', stats.system.firmware || '--');
      this.setText('sys-serial', stats.system.serial || '--');
      this.setText('sys-temp', stats.system.temperature ? `${stats.system.temperature}°C` : '--');
    }

    // Update port stats
    if (stats.ports && stats.ports.length > 0) {
      this.updatePort(1, stats.ports[0]);
      if (stats.ports.length > 1) {
        this.updatePort(2, stats.ports[1]);
      }
    }
  },

  updatePort(portNum, portData) {
    if (!portData) return;

    const prefix = `port${portNum}`;

    // Status badge
    const statusBadge = document.getElementById(`${prefix}-status`);
    if (statusBadge) {
      const isUp = portData.status === 'up';
      statusBadge.textContent = isUp ? 'UP' : 'DOWN';
      statusBadge.className = `port-badge ${isUp ? 'up' : 'down'}`;
    }

    // Port LEDs
    const linkLed = document.getElementById(`${prefix}-link-led`);
    if (linkLed) {
      linkLed.classList.toggle('active', portData.status === 'up');
    }

    // Stats
    this.setText(`${prefix}-rx`, this.formatNumber(portData.rxPackets));
    this.setText(`${prefix}-tx`, this.formatNumber(portData.txPackets));
    this.setText(`${prefix}-rx-bytes`, this.formatBytes(portData.rxBytes));
    this.setText(`${prefix}-tx-bytes`, this.formatBytes(portData.txBytes));
    this.setText(`${prefix}-errors`, this.formatNumber(portData.errors));
    this.setText(`${prefix}-discards`, this.formatNumber(portData.discards));
  },

  updateConnectionStatus(status) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (status.connected && status.boardReady) {
      indicator?.classList.add('on');
      if (text) text.textContent = 'Connected';
    } else if (status.connected) {
      indicator?.classList.remove('on');
      if (text) text.textContent = 'Initializing...';
    } else {
      indicator?.classList.remove('on');
      if (text) text.textContent = 'Disconnected';
    }
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

  async loadInitialData() {
    try {
      const result = await API.getConfig();
      if (result.config) {
        this.parseConfig(result.config);
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  },

  parseConfig(config) {
    // Extract system info from hardware
    const hardware = config?.['ietf-hardware:hardware']?.component || [];
    const board = hardware.find(c => c.class === 'chassis');
    const tempSensor = hardware.find(c => c.name === 'SwTmp');

    if (board) {
      this.setText('sys-model', board['model-name'] || '--');
      this.setText('sys-firmware', board['firmware-rev'] || '--');
      this.setText('sys-serial', board['serial-num'] || '--');
    }

    if (tempSensor) {
      const temp = tempSensor['sensor-data']?.value;
      this.setText('sys-temp', temp ? `${temp}°C` : '--');
      this.setText('sys-temp-top', temp ? `${temp}°C` : '--°C');
    }

    // Extract interface info
    const interfaces = config?.['ietf-interfaces:interfaces']?.interface || [];
    interfaces.forEach((iface, index) => {
      const portNum = index + 1;
      if (portNum <= 2) {
        // Get MAC address
        this.setText('sys-mac', iface['phys-address'] || '--');

        this.updatePort(portNum, {
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
        });
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
      const speed = iface['ieee802-ethernet-interface:ethernet']?.speed || 1;

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
  }
};

window.Dashboard = Dashboard;
