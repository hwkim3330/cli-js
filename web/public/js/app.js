/**
 * Main Application - TSN Switch Manager
 */

const App = {
  currentPage: 'dashboard',
  isConnected: false,
  pageSubtitles: {
    dashboard: 'System Overview',
    ports: 'Port Configuration',
    vlan: 'Virtual LAN Settings',
    fdb: 'Forwarding Database',
    qos: 'Quality of Service',
    scheduler: 'IEEE 802.1Qbv',
    psfp: 'Per-Stream Filtering',
    config: 'Device Configuration',
    monitor: 'Real-time Statistics'
  },

  init() {
    // Initialize modules
    Dashboard.init();
    ConfigEditor.init();
    Monitor.init();
    Scheduler.init();

    // Setup navigation
    this.setupNavigation();
    this.setupTabs();

    // Setup connection controls
    this.setupConnectionControls();

    // Connect WebSocket
    wsClient.connect();
    wsClient.on('status', (data) => this.handleStatusUpdate(data));
    wsClient.on('stats', (data) => this.handleStatsUpdate(data));

    // Load ports on start
    this.refreshPorts();

    // Check initial status
    this.checkStatus();

    // Refresh button
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      if (this.isConnected) {
        Dashboard.loadInitialData();
      }
    });
  },

  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.navigateTo(page);
      });
    });
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
          const parent = tabContainer.parentElement;
          parent.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId);
          });
        });
      });
    });
  },

  navigateTo(page) {
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update page visibility
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `${page}-page`);
    });

    // Update title
    const titles = {
      dashboard: 'Dashboard',
      ports: 'Ports',
      vlan: 'VLAN',
      fdb: 'MAC Table',
      qos: 'QoS Settings',
      scheduler: 'TAS Scheduler',
      psfp: 'PSFP',
      config: 'Configuration',
      monitor: 'Monitoring'
    };

    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('page-subtitle').textContent = this.pageSubtitles[page] || '';

    this.currentPage = page;

    // Load page-specific data
    if (this.isConnected) {
      if (page === 'config') {
        ConfigEditor.loadConfig();
      }
    }
  },

  setupConnectionControls() {
    const connectBtn = document.getElementById('connect-btn');
    connectBtn?.addEventListener('click', () => this.toggleConnection());

    // Refresh ports on dropdown click
    document.getElementById('port-select')?.addEventListener('focus', () => {
      this.refreshPorts();
    });
  },

  async refreshPorts() {
    try {
      const result = await API.listPorts();
      const select = document.getElementById('port-select');

      // Clear existing options except first
      while (select.options.length > 1) {
        select.remove(1);
      }

      // Add port options
      if (result.ports && result.ports.length > 0) {
        result.ports.forEach(port => {
          const option = document.createElement('option');
          option.value = port.path;
          option.textContent = `${port.path}`;
          select.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Failed to refresh ports:', error);
    }
  },

  async toggleConnection() {
    const btn = document.getElementById('connect-btn');
    const select = document.getElementById('port-select');

    if (this.isConnected) {
      // Disconnect
      try {
        btn.textContent = 'Disconnecting...';
        btn.disabled = true;
        await API.disconnect();
        this.handleStatusUpdate({ connected: false, boardReady: false });
      } catch (error) {
        alert(`Disconnect failed: ${error.message}`);
      } finally {
        btn.disabled = false;
      }
    } else {
      // Connect
      const port = select.value;
      if (!port) {
        alert('Please select a port');
        return;
      }

      try {
        btn.textContent = 'Connecting...';
        btn.disabled = true;
        select.disabled = true;
        await API.connect(port);
        // Status will be updated via WebSocket
      } catch (error) {
        alert(`Connection failed: ${error.message}`);
        this.handleStatusUpdate({ connected: false, boardReady: false });
      } finally {
        btn.disabled = false;
        select.disabled = false;
      }
    }
  },

  async checkStatus() {
    try {
      const result = await API.getStatus();
      this.handleStatusUpdate(result);
    } catch (error) {
      console.error('Status check failed:', error);
    }
  },

  handleStatusUpdate(status) {
    this.isConnected = status.connected && status.boardReady;

    const btn = document.getElementById('connect-btn');
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (status.connected && status.boardReady) {
      btn.textContent = 'Disconnect';
      indicator.classList.add('on');
      text.textContent = 'Connected';

      // Load initial dashboard data
      Dashboard.loadInitialData();
    } else if (status.connected) {
      btn.textContent = 'Waiting...';
      indicator.classList.remove('on');
      text.textContent = 'Initializing...';
    } else {
      btn.textContent = 'Connect';
      indicator.classList.remove('on');
      text.textContent = 'Disconnected';
    }

    // Update dashboard connection status
    Dashboard.updateConnectionStatus(status);
  },

  handleStatsUpdate(stats) {
    // Update top bar
    if (stats.system?.temperature) {
      document.getElementById('sys-temp-top').textContent = `${stats.system.temperature}°C`;
    }

    // Calculate uptime from current-time if available
    if (stats.timestamp) {
      const uptime = Math.floor(stats.timestamp / 1000);
      const hours = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const secs = uptime % 60;
      document.getElementById('sys-uptime').textContent =
        `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Update port LEDs
    if (stats.ports) {
      stats.ports.forEach((port, i) => {
        const portNum = i + 1;
        const linkLed = document.getElementById(`port${portNum}-link-led`);
        const actLed = document.getElementById(`port${portNum}-act-led`);

        if (linkLed) {
          linkLed.classList.toggle('active', port.status === 'up');
        }
        if (actLed && port.rxPackets + port.txPackets > 0) {
          actLed.classList.add('active');
          setTimeout(() => actLed.classList.remove('active'), 200);
        }
      });
    }
  }
};

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
