/**
 * SID Transformer - Convert YANG names to delta-SID encoded CBOR structure
 */

const SIDTransformer = {
  // Reverse map: YANG path -> SID
  reverseMap: null,

  init() {
    if (this.reverseMap) return;

    this.reverseMap = {};
    for (const [sid, info] of Object.entries(SID_MAP.map)) {
      const path = info.path;
      if (path) {
        // Store by full path
        this.reverseMap[path] = parseInt(sid, 10);

        // Also store by leaf name for easier lookup
        const leafName = this.extractLeafName(path);
        if (!this.reverseMap[leafName]) {
          this.reverseMap[leafName] = parseInt(sid, 10);
        }
      }
    }
  },

  extractLeafName(path) {
    if (!path) return path;
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const parts = cleanPath.split('/');
    return parts[parts.length - 1];
  },

  /**
   * Find SID for a YANG path/name
   */
  findSID(yangName, parentPath = '') {
    this.init();

    // Try full path first
    const fullPath = parentPath ? `${parentPath}/${yangName}` : `/${yangName}`;
    if (this.reverseMap[fullPath]) {
      return this.reverseMap[fullPath];
    }

    // Try with leading slash
    if (this.reverseMap[`/${yangName}`]) {
      return this.reverseMap[`/${yangName}`];
    }

    // Try just the name
    if (this.reverseMap[yangName]) {
      return this.reverseMap[yangName];
    }

    return null;
  },

  /**
   * Transform YANG structure to delta-SID encoded structure
   * @param {Object} data - YANG structured data
   * @param {string} parentPath - Parent YANG path for context
   * @param {number} parentSid - Parent SID for delta calculation
   * @returns {Object} Delta-SID encoded structure
   */
  transform(data, parentPath = '', parentSid = 0) {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map(item => this.transform(item, parentPath, parentSid));
    }

    if (typeof data === 'object') {
      const result = {};

      for (const [key, value] of Object.entries(data)) {
        // Try to find the SID for this key
        const currentPath = parentPath ? `${parentPath}/${key}` : `/${key}`;
        const sid = this.findSID(key, parentPath);

        if (sid !== null) {
          // Calculate delta from parent
          const deltaSid = sid - parentSid;
          result[deltaSid] = this.transform(value, currentPath, sid);
        } else {
          // Keep original key if no SID found
          result[key] = this.transform(value, currentPath, parentSid);
        }
      }

      return result;
    }

    return data;
  },

  /**
   * Build a patch object for specific configuration changes
   * @param {string} module - Module name (e.g., 'ietf-interfaces:interfaces')
   * @param {Object} patch - Patch data
   * @returns {Object} Delta-SID encoded patch
   */
  buildPatch(module, patch) {
    this.init();

    const moduleSid = this.findSID(module);
    if (!moduleSid) {
      console.error(`Module SID not found for: ${module}`);
      return null;
    }

    const result = {};
    result[moduleSid] = this.transform(patch, `/${module}`, moduleSid);
    return result;
  },

  /**
   * Build interface enable/disable patch
   */
  buildInterfacePatch(interfaceName, enabled) {
    // ietf-interfaces:interfaces SID = 2005
    // interface list SID = 2005 + 23 = 2028
    // name SID = 2028 + 5 = 2033
    // enabled SID = 2028 + 4 = 2032

    return {
      2005: {  // ietf-interfaces:interfaces
        23: [  // interface
          {
            5: interfaceName,  // name
            4: enabled         // enabled
          }
        ]
      }
    };
  },

  /**
   * Build TAS (802.1Qbv) gate-enabled patch
   */
  buildTASPatch(interfaceName, gateEnabled) {
    return {
      2005: {  // ietf-interfaces:interfaces
        23: [  // interface
          {
            5: interfaceName,  // name
            2970: {  // ieee802-dot1q-sched augment
              22: {  // gate-parameters
                1: gateEnabled  // gate-enabled
              }
            }
          }
        ]
      }
    };
  },

  /**
   * Build Priority to Traffic Class (Queue) mapping patch
   * Maps 802.1p priority values (0-7) to traffic classes (queues)
   *
   * SID Structure:
   * - interface: 2028 (delta 23 from 2005)
   * - bridge-port: 7163 (delta 5135 from 2028)
   * - traffic-class: 7240 (delta 77 from 7163)
   * - traffic-class-table: 7243 (delta 3 from 7240)
   * - priority0-7: 7245-7252 (delta 2-9 from 7243)
   *
   * @param {string} interfaceName - Interface name (e.g., "eth0")
   * @param {number[]} priorityToQueue - Array of 8 queue numbers for priority 0-7
   */
  buildTrafficClassPatch(interfaceName, priorityToQueue) {
    // Build traffic-class-table with priority0-7 mappings
    const trafficClassTable = {
      1: 8  // number-of-traffic-classes = 8
    };

    // Add priority0-7 (delta 2-9 from traffic-class-table)
    for (let i = 0; i < 8; i++) {
      trafficClassTable[i + 2] = priorityToQueue[i];
    }

    return {
      2005: {  // ietf-interfaces:interfaces
        23: [  // interface
          {
            5: interfaceName,  // name
            5135: {  // bridge-port (7163 - 2028)
              77: {  // traffic-class (7240 - 7163)
                3: trafficClassTable  // traffic-class-table (7243 - 7240)
              }
            }
          }
        ]
      }
    };
  },

  /**
   * Build Priority Regeneration patch
   * Remaps incoming priority to different priority values
   *
   * @param {string} interfaceName - Interface name
   * @param {number[]} regenerationMap - Array of 8 regenerated priority values
   */
  buildPriorityRegenerationPatch(interfaceName, regenerationMap) {
    // priority-regeneration: 7200 (delta 37 from 7163)
    // priority0-7: delta 1-8 from 7200
    const priorityRegen = {};
    for (let i = 0; i < 8; i++) {
      priorityRegen[i + 1] = regenerationMap[i];
    }

    return {
      2005: {  // ietf-interfaces:interfaces
        23: [  // interface
          {
            5: interfaceName,  // name
            5135: {  // bridge-port
              37: priorityRegen  // priority-regeneration
            }
          }
        ]
      }
    };
  },

  /**
   * Build QoS Shaper patch (Microchip specific)
   *
   * @param {string} interfaceName - Interface name
   * @param {number} trafficClass - Traffic class (0-7)
   * @param {number} cir - Committed Information Rate (kbps)
   * @param {number} cbs - Committed Burst Size (bytes)
   */
  buildQosShaperPatch(interfaceName, trafficClass, cir, cbs) {
    // eth-qos: 8048 (delta 6020 from 2028)
    // config: 8049 (delta 1 from 8048)
    // traffic-class-shapers: 8051 (delta 2 from 8049)

    return {
      2005: {
        23: [
          {
            5: interfaceName,
            6020: {  // eth-qos
              1: {  // config
                2: [{  // traffic-class-shapers
                  1: trafficClass,  // traffic-class
                  4: {  // single-leaky-bucket
                    1: cbs,  // committed-burst-size
                    2: cir   // committed-information-rate
                  }
                }]
              }
            }
          }
        ]
      }
    };
  },

  /**
   * Build Default Priority patch
   * Sets the default priority for untagged frames
   *
   * @param {string} interfaceName - Interface name
   * @param {number} priority - Default priority (0-7)
   */
  buildDefaultPriorityPatch(interfaceName, priority) {
    // default-priority: 7164 (delta 1 from 7163)
    return {
      2005: {
        23: [
          {
            5: interfaceName,
            5135: {  // bridge-port
              1: priority  // default-priority
            }
          }
        ]
      }
    };
  }
};

window.SIDTransformer = SIDTransformer;
