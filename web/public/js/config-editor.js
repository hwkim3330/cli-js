/**
 * Configuration Editor Module
 */

const ConfigEditor = {
  currentConfig: null,
  yamlEditor: null,

  init() {
    this.yamlEditor = document.getElementById('config-yaml');

    document.getElementById('load-config-btn').addEventListener('click', () => this.loadConfig());
    document.getElementById('apply-config-btn').addEventListener('click', () => this.applyConfig());
  },

  async loadConfig() {
    try {
      const btn = document.getElementById('load-config-btn');
      btn.textContent = 'Loading...';
      btn.disabled = true;

      const result = await API.getConfig();
      if (result.yaml) {
        // Use server-generated YAML (properly formatted)
        this.currentConfig = result.config;
        this.yamlEditor.value = result.yaml;
      } else if (result.config) {
        // Fallback to JSON display
        this.currentConfig = result.config;
        this.yamlEditor.value = JSON.stringify(result.config, null, 2);
      }
    } catch (error) {
      alert(`Failed to load config: ${error.message}`);
    } finally {
      const btn = document.getElementById('load-config-btn');
      btn.textContent = 'Load Config';
      btn.disabled = false;
    }
  },

  async applyConfig() {
    const yaml = this.yamlEditor.value.trim();
    if (!yaml) {
      alert('Please enter configuration YAML');
      return;
    }

    try {
      const btn = document.getElementById('apply-config-btn');
      btn.textContent = 'Applying...';
      btn.disabled = true;

      const result = await API.patchConfig(yaml);
      if (result.success) {
        alert('Configuration applied successfully!');
        // Reload config to see changes
        await this.loadConfig();
      } else {
        alert(`Failed to apply config: CoAP code ${result.code}`);
      }
    } catch (error) {
      alert(`Failed to apply config: ${error.message}`);
    } finally {
      const btn = document.getElementById('apply-config-btn');
      btn.textContent = 'Apply Changes';
      btn.disabled = false;
    }
  },

  // Simple JSON to YAML converter (basic implementation)
  jsonToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let result = '';

    if (Array.isArray(obj)) {
      obj.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          result += `${spaces}- `;
          const lines = this.jsonToYaml(item, indent + 1).split('\n');
          result += lines[0].trim() + '\n';
          lines.slice(1).forEach(line => {
            if (line.trim()) result += `${spaces}  ${line.trim()}\n`;
          });
        } else {
          result += `${spaces}- ${this.formatValue(item)}\n`;
        }
      });
    } else if (typeof obj === 'object' && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value) && value.length === 0) {
            result += `${spaces}${key}: []\n`;
          } else if (Object.keys(value).length === 0) {
            result += `${spaces}${key}: {}\n`;
          } else {
            result += `${spaces}${key}:\n`;
            result += this.jsonToYaml(value, indent + 1);
          }
        } else {
          result += `${spaces}${key}: ${this.formatValue(value)}\n`;
        }
      });
    }

    return result;
  },

  formatValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return '';
    if (typeof value === 'string') {
      // Quote strings that need it
      if (value.includes(':') || value.includes('#') || value.includes('\n') ||
          value.startsWith(' ') || value.endsWith(' ') || value === '') {
        return `'${value.replace(/'/g, "''")}'`;
      }
      return value;
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }
};

window.ConfigEditor = ConfigEditor;
