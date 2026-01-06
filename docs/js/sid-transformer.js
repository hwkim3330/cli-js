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
    // ieee802-dot1q-sched:gate-parameters SID relative to interface
    // This is a complex nested structure

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
  }
};

window.SIDTransformer = SIDTransformer;
