/**
 * Transformer Module for Instance-Identifier (RFC 8072 style)
 *
 * Directly transforms instance-identifier format to Delta-SID CBOR Map
 * without intermediate RFC 7951 conversion.
 *
 * Input: [{ "/module:path/list[key='value']/leaf": value }, ...]
 * Output: CBOR Map with Delta-SID keys
 */

import { encodeValue } from './value-encoder.js';

export { parseInstanceIdPath, buildYangPath, resolveSid };

/**
 * Parse instance-identifier path into components
 * @param {string} path - Instance-identifier path (e.g., "/ietf-interfaces:interfaces/interface[name='1']/enabled")
 * @returns {Array<Object>} Array of path components
 */
function parseInstanceIdPath(path) {
  const components = [];
  const segments = path.startsWith('/') ? path.substring(1).split('/') : path.split('/');

  // Regex: (module:)?(nodeName)([key='value'])*
  const segmentRegex = /^(?:([a-zA-Z0-9_-]+):)?([a-zA-Z0-9_-]+)((?:\[[^\]]+\])*)$/;
  const predicateRegex = /\[([a-zA-Z0-9_-]+)='([^']+)'\]/g;

  for (const segment of segments) {
    if (!segment) continue;

    const match = segment.match(segmentRegex);
    if (!match) {
      throw new Error(`Invalid instance-identifier segment: "${segment}"`);
    }

    const [, modulePrefix, nodeName, predicatesStr] = match;

    // Extract list keys if present
    const keys = [];
    if (predicatesStr) {
      let predicateMatch;
      while ((predicateMatch = predicateRegex.exec(predicatesStr)) !== null) {
        keys.push({ keyName: predicateMatch[1], keyValue: predicateMatch[2] });
      }
      predicateRegex.lastIndex = 0;
    }

    components.push({
      module: modulePrefix || null,
      name: nodeName,
      prefixedName: modulePrefix ? `${modulePrefix}:${nodeName}` : nodeName,
      isListEntry: keys.length > 0,
      keys: keys
    });
  }

  return components;
}

/**
 * Build YANG path from components (for SID lookup)
 * @param {Array<Object>} components - Path components
 * @param {number} upToIndex - Index up to which to build path (-1 for all)
 * @returns {Object} { prefixedPath, strippedPath }
 */
function buildYangPath(components, upToIndex = -1) {
  const endIdx = upToIndex === -1 ? components.length : upToIndex + 1;
  const prefixedParts = [];
  const strippedParts = [];

  for (let i = 0; i < endIdx; i++) {
    prefixedParts.push(components[i].prefixedName);
    strippedParts.push(components[i].name);
  }

  return {
    prefixedPath: prefixedParts.join('/'),
    strippedPath: strippedParts.join('/')
  };
}

/**
 * Resolve path to SID using sidInfo
 * @param {string} prefixedPath - Prefixed YANG path
 * @param {string} strippedPath - Stripped YANG path
 * @param {Object} sidInfo - SID tree
 * @returns {number|null} SID or null
 */
function resolveSid(prefixedPath, strippedPath, sidInfo) {
  // Try prefixed path first
  if (sidInfo.prefixedPathToSid?.has(prefixedPath)) {
    return sidInfo.prefixedPathToSid.get(prefixedPath);
  }
  // Fall back to stripped path
  if (sidInfo.pathToSid?.has(strippedPath)) {
    return sidInfo.pathToSid.get(strippedPath);
  }
  return null;
}

/**
 * Get node info for Delta-SID calculation
 * @param {string} strippedPath - Stripped YANG path
 * @param {Object} sidInfo - SID tree
 * @returns {Object|null} Node info with parent and deltaSid
 */
function getNodeInfo(strippedPath, sidInfo) {
  return sidInfo.nodeInfo?.get(strippedPath) || null;
}

/**
 * Transform instance-identifier array to Delta-SID CBOR structure
 *
 * @param {Array<Object>} instanceIdArray - Array of { "/path": value } objects
 * @param {Object} typeTable - Type table from yang-type-extractor
 * @param {Object} sidInfo - SID tree from sid-resolver
 * @param {Object} options - Options
 * @returns {Map} CBOR-ready Map with Delta-SID keys
 */
export function transformInstanceIdentifier(instanceIdArray, typeTable, sidInfo, options = {}) {
  const useMap = options.useMap !== false;
  const sortMode = options.sortMode || 'velocity';
  const verbose = options.verbose || false;

  // Build a hierarchical structure first, then convert to CBOR Map
  // We need to handle:
  // 1. Multiple paths that share common ancestors
  // 2. List entries with keys
  // 3. Delta-SID calculation based on parent

  // Step 1: Group paths by their structure
  const pathEntries = [];

  for (const item of instanceIdArray) {
    const path = Object.keys(item)[0];
    const value = item[path];
    const components = parseInstanceIdPath(path);

    pathEntries.push({ path, components, value });
  }

  // Step 2: Build hierarchical CBOR Map
  // For each path, we need to:
  // - Find or create parent containers
  // - Handle list entries
  // - Set leaf values with Delta-SID

  const rootMap = useMap ? new Map() : {};

  const setInMap = (map, key, value) => {
    if (map instanceof Map) {
      map.set(key, value);
    } else {
      map[key] = value;
    }
  };

  const getFromMap = (map, key) => {
    if (map instanceof Map) {
      return map.get(key);
    } else {
      return map[key];
    }
  };

  const hasInMap = (map, key) => {
    if (map instanceof Map) {
      return map.has(key);
    } else {
      return key in map;
    }
  };

  for (const { path, components, value } of pathEntries) {
    let currentMap = rootMap;
    let parentSid = null;

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const isLast = (i === components.length - 1);
      const { prefixedPath, strippedPath } = buildYangPath(components, i);

      // Get SID for this path segment
      const currentSid = resolveSid(prefixedPath, strippedPath, sidInfo);

      if (currentSid === null) {
        if (verbose) {
          console.warn(`No SID found for path: ${prefixedPath}`);
        }
        break;
      }

      // Calculate key (Delta-SID or Absolute-SID)
      const nodeInfo = getNodeInfo(strippedPath, sidInfo);
      let encodedKey;

      if (nodeInfo && nodeInfo.parent !== null && nodeInfo.parent === parentSid) {
        // Use Delta-SID
        encodedKey = nodeInfo.deltaSid;
      } else {
        // Use Absolute-SID
        encodedKey = currentSid;
      }

      if (comp.isListEntry) {
        // Handle list entry
        // Ensure list array exists
        if (!hasInMap(currentMap, encodedKey)) {
          setInMap(currentMap, encodedKey, []);
        }

        const listArray = getFromMap(currentMap, encodedKey);

        // Find or create list entry with matching keys
        let listEntry = null;
        for (const entry of listArray) {
          let matches = true;
          for (const { keyName, keyValue } of comp.keys) {
            // Find key SID
            const keyPath = `${strippedPath}/${keyName}`;
            const keySid = sidInfo.pathToSid?.get(keyPath);

            if (keySid === null) continue;

            // Calculate key's Delta-SID
            const keyNodeInfo = getNodeInfo(keyPath, sidInfo);
            let keyEncodedKey;
            if (keyNodeInfo && keyNodeInfo.parent === currentSid) {
              keyEncodedKey = keyNodeInfo.deltaSid;
            } else {
              keyEncodedKey = keySid;
            }

            const entryValue = getFromMap(entry, keyEncodedKey);
            if (entryValue !== keyValue) {
              matches = false;
              break;
            }
          }
          if (matches) {
            listEntry = entry;
            break;
          }
        }

        if (!listEntry) {
          // Create new list entry with keys
          listEntry = useMap ? new Map() : {};

          for (const { keyName, keyValue } of comp.keys) {
            const keyPath = `${strippedPath}/${keyName}`;
            const keySid = sidInfo.pathToSid?.get(keyPath);

            if (keySid === null) continue;

            const keyNodeInfo = getNodeInfo(keyPath, sidInfo);
            let keyEncodedKey;
            if (keyNodeInfo && keyNodeInfo.parent === currentSid) {
              keyEncodedKey = keyNodeInfo.deltaSid;
            } else {
              keyEncodedKey = keySid;
            }

            // Encode key value (usually string)
            const keyTypeInfo = typeTable.types?.get(keyPath);
            const encodedKeyValue = keyTypeInfo
              ? encodeValue(keyValue, keyTypeInfo, sidInfo, false)
              : keyValue;

            setInMap(listEntry, keyEncodedKey, encodedKeyValue);
          }

          listArray.push(listEntry);
        }

        currentMap = listEntry;
        parentSid = currentSid;
      } else if (isLast) {
        // Leaf node - set value
        const typeInfo = typeTable.types?.get(strippedPath);
        const encodedValue = typeInfo
          ? encodeValue(value, typeInfo, sidInfo, false)
          : value;

        setInMap(currentMap, encodedKey, encodedValue);
      } else {
        // Container node - ensure it exists
        if (!hasInMap(currentMap, encodedKey)) {
          setInMap(currentMap, encodedKey, useMap ? new Map() : {});
        }

        currentMap = getFromMap(currentMap, encodedKey);
        parentSid = currentSid;
      }
    }
  }

  // Step 3: Sort the map if needed
  if (sortMode === 'velocity' && useMap) {
    return sortMapVelocity(rootMap);
  }

  return rootMap;
}

/**
 * Sort Map entries in VelocityDriveSP order
 * Delta-SIDs first, then Absolute-SIDs, both sorted by value
 * @param {Map} map - Map to sort
 * @returns {Map} Sorted map
 */
function sortMapVelocity(map) {
  if (!(map instanceof Map)) return map;

  const entries = [...map.entries()];

  // Recursively sort nested maps
  const sortedEntries = entries.map(([key, value]) => {
    if (value instanceof Map) {
      return [key, sortMapVelocity(value)];
    } else if (Array.isArray(value)) {
      return [key, value.map(item => item instanceof Map ? sortMapVelocity(item) : item)];
    }
    return [key, value];
  });

  // Sort: smaller keys first (both delta and absolute are just numbers)
  sortedEntries.sort((a, b) => a[0] - b[0]);

  return new Map(sortedEntries);
}

/**
 * Check if data is in instance-identifier format
 * @param {*} data - Parsed YAML/JSON data
 * @returns {boolean}
 */
export function isInstanceIdentifierFormat(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return false;
  }

  return data.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const keys = Object.keys(item);
    if (keys.length !== 1) return false;
    return typeof keys[0] === 'string' && keys[0].startsWith('/');
  });
}

/**
 * Extract SIDs from instance-identifier array (for iFETCH)
 *
 * iFETCH requires SID identifiers. For list entries, the format is [SID, key1, key2, ...].
 * Each path becomes a separate CBOR-encodable entry.
 *
 * @param {Array<Object>} instanceIdArray - Array of { "/path": value } objects
 * @param {Object} sidInfo - SID tree from sid-resolver
 * @param {Object} options - Options
 * @returns {Array} Array of SID entries (each entry is either a number or [sid, key1, key2, ...])
 *
 * @example
 * // Input: [{ "/ietf-interfaces:interfaces/interface[name='1']": null }]
 * // Output: [[2033, "1"]] (SID + key value for list entry)
 *
 * // Input: [{ "/ietf-constrained-yang-library:yang-library/checksum": null }]
 * // Output: [29304] (just SID for non-list)
 */
export function extractSidsFromInstanceIdentifier(instanceIdArray, sidInfo, options = {}) {
  const verbose = options.verbose || false;
  const entries = [];

  for (const item of instanceIdArray) {
    const path = Object.keys(item)[0];
    const components = parseInstanceIdPath(path);

    if (components.length === 0) {
      if (verbose) {
        console.warn(`Empty path: ${path}`);
      }
      continue;
    }

    // Build the full path to resolve SID
    const { prefixedPath, strippedPath } = buildYangPath(components, -1);

    // Get the SID for the target (last) path element
    const sid = resolveSid(prefixedPath, strippedPath, sidInfo);

    if (sid === null) {
      if (verbose) {
        console.warn(`No SID found for path: ${prefixedPath}`);
      }
      continue;
    }

    // Collect ALL keys from the ENTIRE path (not just last component)
    // mvdct traverses entire path and collects keys from list entries
    const allKeys = [];
    for (const comp of components) {
      if (comp.isListEntry && comp.keys.length > 0) {
        for (const k of comp.keys) {
          allKeys.push(k.keyValue);
        }
      }
    }

    if (allKeys.length > 0) {
      // Has keys: [sid, key1, key2, ...]
      const entry = [sid, ...allKeys];
      entries.push(entry);

      if (verbose) {
        console.log(`  Path: ${path} -> [${sid}, ${allKeys.map(v => `"${v}"`).join(', ')}]`);
      }
    } else {
      // No keys: just SID
      entries.push(sid);

      if (verbose) {
        console.log(`  Path: ${path} -> SID: ${sid}`);
      }
    }
  }

  return entries;
}

/**
 * Get transformation statistics
 * @param {Array} instanceIdArray - Original array
 * @param {Map} transformed - Transformed map
 * @returns {Object} Statistics
 */
export function getInstanceIdTransformStats(instanceIdArray, transformed) {
  const countEntries = (obj) => {
    let count = 0;
    const values = obj instanceof Map ? [...obj.values()] : Object.values(obj);
    for (const value of values) {
      count++;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        count += countEntries(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            count += countEntries(item);
          }
        }
      }
    }
    return count;
  };

  return {
    inputPaths: instanceIdArray.length,
    outputEntries: countEntries(transformed),
    format: 'instance-identifier'
  };
}
