/**
 * Real-time Monitoring Module
 */

const Monitor = {
  chart: null,
  chartData: {
    labels: [],
    port1Rx: [],
    port1Tx: [],
    port2Rx: [],
    port2Tx: []
  },
  maxDataPoints: 30,
  prevStats: null,

  init() {
    this.initChart();
    wsClient.on('stats', (data) => this.updateMonitor(data));
  },

  initChart() {
    const canvas = document.getElementById('traffic-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Simple line chart drawing
    this.chart = {
      ctx,
      canvas,
      draw: () => this.drawChart()
    };
  },

  updateMonitor(stats) {
    if (!stats || !stats.ports) return;

    // Calculate rates (packets per second)
    const now = Date.now();
    if (this.prevStats) {
      const timeDiff = (now - this.prevStats.timestamp) / 1000;
      if (timeDiff > 0) {
        const port1 = stats.ports[0] || {};
        const port2 = stats.ports[1] || {};
        const prevPort1 = this.prevStats.ports[0] || {};
        const prevPort2 = this.prevStats.ports[1] || {};

        const port1RxRate = Math.round((port1.rxPackets - prevPort1.rxPackets) / timeDiff);
        const port1TxRate = Math.round((port1.txPackets - prevPort1.txPackets) / timeDiff);
        const port2RxRate = Math.round((port2.rxPackets - prevPort2.rxPackets) / timeDiff);
        const port2TxRate = Math.round((port2.txPackets - prevPort2.txPackets) / timeDiff);

        // Add to chart data
        const timeLabel = new Date().toLocaleTimeString();
        this.chartData.labels.push(timeLabel);
        this.chartData.port1Rx.push(Math.max(0, port1RxRate));
        this.chartData.port1Tx.push(Math.max(0, port1TxRate));
        this.chartData.port2Rx.push(Math.max(0, port2RxRate));
        this.chartData.port2Tx.push(Math.max(0, port2TxRate));

        // Limit data points
        if (this.chartData.labels.length > this.maxDataPoints) {
          this.chartData.labels.shift();
          this.chartData.port1Rx.shift();
          this.chartData.port1Tx.shift();
          this.chartData.port2Rx.shift();
          this.chartData.port2Tx.shift();
        }

        // Update UI
        document.getElementById('mon-port1-rx').textContent = port1RxRate;
        document.getElementById('mon-port1-tx').textContent = port1TxRate;
        document.getElementById('mon-port2-rx').textContent = port2RxRate;
        document.getElementById('mon-port2-tx').textContent = port2TxRate;

        // Redraw chart
        this.drawChart();
      }
    }

    this.prevStats = { ...stats, timestamp: now };
  },

  drawChart() {
    if (!this.chart || !this.chart.ctx) return;

    const ctx = this.chart.ctx;
    const canvas = this.chart.canvas;
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Calculate max value
    const allValues = [
      ...this.chartData.port1Rx,
      ...this.chartData.port1Tx,
      ...this.chartData.port2Rx,
      ...this.chartData.port2Tx
    ];
    const maxVal = Math.max(10, ...allValues);

    // Draw lines
    const colors = {
      port1Rx: '#3b82f6',
      port1Tx: '#60a5fa',
      port2Rx: '#10b981',
      port2Tx: '#34d399'
    };

    Object.entries(colors).forEach(([key, color]) => {
      const data = this.chartData[key];
      if (data.length < 2) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      data.forEach((val, i) => {
        const x = (i / (this.maxDataPoints - 1)) * width;
        const y = height - (val / maxVal) * height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    });

    // Draw legend
    ctx.font = '12px system-ui';
    let legendX = 10;
    Object.entries(colors).forEach(([key, color]) => {
      ctx.fillStyle = color;
      ctx.fillRect(legendX, 10, 20, 10);
      ctx.fillStyle = '#e5e7eb';
      const label = key.replace('port', 'P').replace('Rx', ' RX').replace('Tx', ' TX');
      ctx.fillText(label, legendX + 25, 18);
      legendX += 80;
    });
  }
};

window.Monitor = Monitor;
