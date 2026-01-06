/**
 * TSN Scheduler Module (IEEE 802.1Qbv)
 */

const Scheduler = {
  numTrafficClasses: 8,
  gateEntries: [],
  cycleTime: 1000, // microseconds

  init() {
    this.renderGateRows();

    document.getElementById('cycle-time').addEventListener('change', (e) => {
      this.cycleTime = parseInt(e.target.value) || 1000;
      this.renderGateEntries();
    });

    document.getElementById('add-entry-btn').addEventListener('click', () => this.addGateEntry());
    document.getElementById('apply-schedule-btn').addEventListener('click', () => this.applySchedule());

    // Initialize with default entry (all gates open)
    this.gateEntries = [{
      gateStates: 0xFF, // All 8 traffic classes open
      timeInterval: this.cycleTime
    }];
    this.renderGateEntries();
  },

  renderGateRows() {
    const container = document.getElementById('gate-rows');
    if (!container) return;

    container.innerHTML = '';

    for (let tc = 0; tc < this.numTrafficClasses; tc++) {
      const row = document.createElement('div');
      row.className = 'gate-row';
      row.innerHTML = `
        <span class="tc-num">TC${tc}</span>
        <div class="gate-bar" id="gate-bar-${tc}"></div>
      `;
      container.appendChild(row);
    }
  },

  renderGateEntries() {
    // Calculate total time and positions
    const totalTime = this.gateEntries.reduce((sum, e) => sum + e.timeInterval, 0);

    for (let tc = 0; tc < this.numTrafficClasses; tc++) {
      const bar = document.getElementById(`gate-bar-${tc}`);
      if (!bar) continue;

      bar.innerHTML = '';

      let currentPos = 0;
      this.gateEntries.forEach((entry, index) => {
        const width = (entry.timeInterval / totalTime) * 100;
        const isOpen = (entry.gateStates >> tc) & 1;

        const segment = document.createElement('div');
        segment.className = `gate-segment ${isOpen ? 'open' : 'closed'}`;
        segment.style.left = `${currentPos}%`;
        segment.style.width = `${width}%`;
        segment.title = `Entry ${index + 1}: ${entry.timeInterval}us - ${isOpen ? 'OPEN' : 'CLOSED'}`;

        // Click to toggle
        segment.addEventListener('click', () => {
          entry.gateStates ^= (1 << tc);
          this.renderGateEntries();
        });

        bar.appendChild(segment);
        currentPos += width;
      });
    }
  },

  addGateEntry() {
    // Add a new entry with half the current cycle time, all gates open
    const newInterval = Math.floor(this.cycleTime / (this.gateEntries.length + 1));

    // Redistribute time among entries
    const timePerEntry = Math.floor(this.cycleTime / (this.gateEntries.length + 1));
    this.gateEntries.forEach(entry => {
      entry.timeInterval = timePerEntry;
    });

    this.gateEntries.push({
      gateStates: 0xFF,
      timeInterval: timePerEntry
    });

    this.renderGateEntries();
  },

  async applySchedule() {
    const portNum = document.getElementById('sched-port-select').value;
    const cycleTimeNs = this.cycleTime * 1000; // Convert us to ns

    // Build the YAML patch for gate schedule
    const gateControlList = this.gateEntries.map((entry, index) => ({
      index,
      'operation-name': 'set-gate-states',
      'gate-states-value': entry.gateStates,
      'time-interval-value': entry.timeInterval * 1000 // Convert to ns
    }));

    const yaml = `
ietf-interfaces:interfaces:
  interface:
    - name: '${portNum}'
      ieee802-dot1q-bridge:bridge-port:
        ieee802-dot1q-sched-bridge:gate-parameter-table:
          admin-cycle-time:
            numerator: ${cycleTimeNs}
            denominator: 1000000000
          admin-control-list:
            gate-control-entry: ${JSON.stringify(gateControlList).replace(/"/g, '')}
          config-change: true
`.trim();

    try {
      const btn = document.getElementById('apply-schedule-btn');
      btn.textContent = 'Applying...';
      btn.disabled = true;

      const result = await API.patchConfig(yaml);
      if (result.success) {
        alert('Schedule applied successfully!');
      } else {
        alert(`Failed to apply schedule: CoAP code ${result.code}`);
      }
    } catch (error) {
      alert(`Failed to apply schedule: ${error.message}`);
    } finally {
      const btn = document.getElementById('apply-schedule-btn');
      btn.textContent = 'Apply Schedule';
      btn.disabled = false;
    }
  },

  loadFromConfig(config) {
    // Extract gate schedule from config if available
    const interfaces = config?.['ietf-interfaces:interfaces']?.interface || [];
    const portNum = document.getElementById('sched-port-select')?.value || '1';

    const iface = interfaces.find(i => i.name === portNum);
    if (!iface) return;

    const gateTable = iface?.['ieee802-dot1q-bridge:bridge-port']?.['ieee802-dot1q-sched-bridge:gate-parameter-table'];
    if (!gateTable) return;

    // Load cycle time
    const cycleTime = gateTable['oper-cycle-time'] || gateTable['admin-cycle-time'];
    if (cycleTime && cycleTime.numerator && cycleTime.denominator) {
      this.cycleTime = Math.round((cycleTime.numerator / cycleTime.denominator) * 1000000); // to us
      document.getElementById('cycle-time').value = this.cycleTime;
    }

    // Load gate entries
    const controlList = gateTable['oper-control-list'] || gateTable['admin-control-list'];
    const entries = controlList?.['gate-control-entry'] || [];

    if (entries.length > 0) {
      this.gateEntries = entries.map(entry => ({
        gateStates: entry['gate-states-value'] || 0xFF,
        timeInterval: Math.round((entry['time-interval-value'] || 0) / 1000) // ns to us
      }));
    }

    this.renderGateEntries();
  }
};

window.Scheduler = Scheduler;
