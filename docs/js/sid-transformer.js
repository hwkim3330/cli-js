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
   *
   * Correct SID values:
   * - /ietf-interfaces:interfaces = 2005
   * - /ietf-interfaces:interfaces/interface = 2033 (delta 28 from 2005)
   * - /ietf-interfaces:interfaces/interface/name = 2042 (delta 9 from 2033)
   * - /ietf-interfaces:interfaces/interface/enabled = 2036 (delta 3 from 2033)
   */
  buildInterfacePatch(interfaceName, enabled) {
    return {
      2005: {  // ietf-interfaces:interfaces
        28: [  // interface (2033 - 2005 = 28)
          {
            9: interfaceName,  // name (2042 - 2033 = 9)
            3: enabled         // enabled (2036 - 2033 = 3)
          }
        ]
      }
    };
  },

  /**
   * Build TAS (802.1Qbv) gate-enabled patch
   *
   * SID Path:
   * - interface = 2033 (delta 28 from 2005)
   * - bridge-port = 7163 (delta 5130 from 2033)
   * - gate-parameter-table = 23101 (delta 15938 from 7163)
   * - gate-enabled = 23125 (delta 24 from 23101)
   */
  buildTASPatch(interfaceName, gateEnabled) {
    return {
      2005: {  // ietf-interfaces:interfaces
        28: [  // interface
          {
            9: interfaceName,  // name
            5130: {  // bridge-port
              15938: {  // gate-parameter-table
                24: gateEnabled  // gate-enabled
              }
            }
          }
        ]
      }
    };
  },

  /**
   * Build Priority to Traffic Class (Queue) mapping patch
   *
   * SID Structure:
   * - interface = 2033 (delta 28 from 2005)
   * - bridge-port = 7163 (delta 5130 from 2033)
   * - traffic-class = 7237 (delta 74 from 7163)
   * - traffic-class-table = 7243 (delta 6 from 7237)
   * - number-of-traffic-classes = 7244 (delta 1 from 7243)
   * - priority0-7 = 7245-7252 (delta 2-9 from 7243)
   */
  buildTrafficClassPatch(interfaceName, priorityToQueue) {
    const trafficClassTable = {
      1: 8  // number-of-traffic-classes (delta 1)
    };

    // priority0-7 (delta 2-9 from traffic-class-table)
    for (let i = 0; i < 8; i++) {
      trafficClassTable[i + 2] = priorityToQueue[i];
    }

    return {
      2005: {
        28: [  // interface
          {
            9: interfaceName,  // name
            5130: {  // bridge-port
              74: {  // traffic-class
                6: trafficClassTable  // traffic-class-table
              }
            }
          }
        ]
      }
    };
  },

  /**
   * Build Priority Regeneration patch
   *
   * SID:
   * - priority-regeneration = 7200 (delta 37 from 7163)
   * - priority0-7 = 7201-7208 (delta 1-8 from 7200)
   */
  buildPriorityRegenerationPatch(interfaceName, regenerationMap) {
    const priorityRegen = {};
    for (let i = 0; i < 8; i++) {
      priorityRegen[i + 1] = regenerationMap[i];
    }

    return {
      2005: {
        28: [  // interface
          {
            9: interfaceName,  // name
            5130: {  // bridge-port
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
   * SID:
   * - eth-qos = 8048 (delta 6015 from 2033)
   * - config = 8049 (delta 1)
   * - traffic-class-shapers = 8051 (delta 2 from config)
   */
  buildQosShaperPatch(interfaceName, trafficClass, cir, cbs) {
    return {
      2005: {
        28: [  // interface
          {
            9: interfaceName,  // name
            6015: {  // eth-qos (8048 - 2033)
              1: {  // config
                2: [{  // traffic-class-shapers
                  1: trafficClass,
                  4: {  // single-leaky-bucket
                    1: cbs,
                    2: cir
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
   *
   * SID: default-priority = 7170 (delta 7 from 7163)
   */
  buildDefaultPriorityPatch(interfaceName, priority) {
    return {
      2005: {
        28: [  // interface
          {
            9: interfaceName,  // name
            5130: {  // bridge-port
              7: priority  // default-priority (7170 - 7163)
            }
          }
        ]
      }
    };
  }
};

window.SIDTransformer = SIDTransformer;
