/**
 * SID Resolver Module
 *
 * Builds SID info and resolves YANG paths to SIDs
 * Supports Delta-SID encoding (RFC 9254)
 * Optimized for fast searching with Map data structure
 */

import fs from 'fs';

/**
 * Build SID info from .sid file
 * @param {string} sidFilePath - Path to .sid JSON file
 * @returns {Promise<object>} SID info with Maps for fast lookup
 */
export async function buildSidInfo(sidFilePath) {
  try {
    const content = await fs.promises.readFile(sidFilePath, 'utf8');
    const sidData = JSON.parse(content); // Object

    // Support both RFC format and simplified format
    const sidFile = sidData['ietf-sid-file:sid-file'] || sidData; // Object

    const info = {
      // BiMap: Path ↔ SID (양방향)
      pathToSid: new Map(),     // YANG path → SID (encoding)
      sidToPath: new Map(),     // SID → YANG path (decoding)
      prefixedPathToSid: new Map(), // Prefixed YANG path → SID
      sidToPrefixedPath: new Map(), // SID → Prefixed YANG path
      pathToPrefixed: new Map(),    // Stripped path → Prefixed path

      // BiMap: Identity ↔ SID (양방향)
      identityToSid: new Map(), // identity name → SID (encoding)
      sidToIdentity: new Map(), // SID → identity name (decoding)

      // Parent-child relationship for Delta-SID (RFC 9254)
      nodeInfo: new Map(),      // path → {sid, parent, deltaSid, prefixedPath}

      // Index for fuzzy path matching (choice/case)
      leafToPaths: new Map()   // leaf node name → [fullPath1, fullPath2, ...]
    };

    // Parse items array (RFC 9254 format)
    const items = sidFile.items || [];

    // Process all items
    items.forEach(item => {
      processSidItem(item, info);
    });

    // NOTE: nodeInfo (parent-child relationships) are NOT calculated here
    // because augmentation parents may be in different .sid files.
    // Parent calculation must be done AFTER merging all modules.
    // See: mergeSidInfos() or caller's Recalculate step.

    return info;

  } catch (error) {
    throw new Error(`SID file parsing error: ${error.message}`);
  }
}

/**
 * Process a single SID item
 * @param {object} item - SID item from .sid file
 * @param {object} info - SID info to populate
 */
function processSidItem(item, info) {
  const sid = item.sid;
  const namespace = item.namespace || 'data';
  const identifier = item.identifier || '';

  // Build YANG path based on namespace
  let yangPath;
  let prefixedPath = null;

  switch (namespace) {
    case 'module':
      // Module-level identifier (usually module name)
      yangPath = identifier;
      break;

    case 'identity':
      // Identity: store in BiMap for bidirectional lookup
      // Extract identity name (remove module prefix)
      const identityName = identifier.includes(':')
        ? identifier.split(':')[1]
        : identifier;
      yangPath = `identity:${identityName}`;
      prefixedPath = `identity:${identifier}`;

      // BiMap: name → SID (encoding)
      info.identityToSid.set(identityName, sid);
      info.identityToSid.set(identifier, sid); // Also store full identifier

      // BiMap: SID → name (decoding)
      info.sidToIdentity.set(sid, identityName);
      break;

    case 'feature':
      // Feature: prefix with 'feature:'
      const featureName = identifier.includes(':')
        ? identifier.split(':')[1]
        : identifier;
      yangPath = `feature:${featureName}`;
      prefixedPath = `feature:${identifier}`;
      break;

    case 'data': // leaf, container, list ...
    default:
      // Data node: extract path from identifier
      // Format: "/module:path/to/leaf" → "path/to/leaf"
      // Remove leading "/" and ALL module prefixes from ALL segments
      // e.g., "/ieee1588-ptp:ptp/parent-ds/ieee802-dot1as-ptp:cumulative-rate-ratio"
      //    → "ptp/parent-ds/cumulative-rate-ratio"
      yangPath = identifier
        .replace(/^\//, '')  // Remove leading /
        .split('/')          // Split by /
        .map(segment => segment.includes(':') ? segment.split(':')[1] : segment)  // Remove prefix from each segment
        .join('/');          // Join back
      prefixedPath = identifier.replace(/^\//, ''); // ^ : anker

      break;
  }

  // Populate leafToPaths index for fuzzy matching
  if (namespace === 'data' && yangPath) {
    const parts = yangPath.split('/');
    const leaf = parts[parts.length - 1];
    if (leaf) {
      if (!info.leafToPaths.has(leaf)) {
        info.leafToPaths.set(leaf, []);
      }
      info.leafToPaths.get(leaf).push(yangPath);
    }
  }

  // Store in both directions for fast lookup
  info.pathToSid.set(yangPath, sid);
  info.sidToPath.set(sid, yangPath);

  if (prefixedPath) {
    info.prefixedPathToSid.set(prefixedPath, sid);
    info.sidToPrefixedPath.set(sid, prefixedPath);
    info.pathToPrefixed.set(yangPath, prefixedPath);
  }
}

/**
 * Resolve YANG path to SID with fuzzy matching for choice/case.
 * @param {string} path - The current path segment (JSON key)
 * @param {object} sidInfo - SID info from buildSidInfo()
 * @param {string} [contextPath=''] - The parent path context.
 * @returns {number|null} SID number or null if not found
 */
export function resolvePathToSid(path, sidInfo, contextPath = '') {
  const fullPath = contextPath ? `${contextPath}/${path}` : path;

  // 1. Direct lookup (most common case)
  if (sidInfo.prefixedPathToSid?.has(fullPath)) {
    return sidInfo.prefixedPathToSid.get(fullPath);
  }
  const fullPathStripped = stripPrefixes(fullPath);
  if (sidInfo.pathToSid.has(fullPathStripped)) {
    return sidInfo.pathToSid.get(fullPathStripped);
  }

  // 2. Fuzzy match fallback for choice/case nodes absent in YAML
  // Uses pre-built leafToPaths index for performance.
  const pathStripped = stripPrefixes(path);
  const candidatePaths = sidInfo.leafToPaths?.get(pathStripped);

  if (!candidatePaths || candidatePaths.length === 0) {
    return null;
  }

  // If only one candidate, it's likely the correct one.
  if (candidatePaths.length === 1) {
    return sidInfo.pathToSid.get(candidatePaths[0]);
  }

  // Multiple candidates, find best match using context.
  const contextPathStripped = stripPrefixes(contextPath);
  const contextSegments = contextPathStripped.split('/').filter(Boolean);

  let bestMatch = null;
  let highestScore = -1;

  for (const candidate of candidatePaths) {
    const candidateSegments = candidate.split('/');
    // Score is the length of the common prefix.
    let score = 0;
    for (let i = 0; i < Math.min(contextSegments.length, candidateSegments.length); i++) {
      if (contextSegments[i] === candidateSegments[i]) {
        score++;
      } else {
        break;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestMatch) {
    return sidInfo.pathToSid.get(bestMatch);
  }

  // If no context match, return first candidate as a last resort
  return sidInfo.pathToSid.get(candidatePaths[0]);
}

/**
 * Resolve SID to YANG path (reverse lookup)
 * @param {number} sid - SID number
 * @param {object} sidInfo - SID info from buildSidInfo()
 * @returns {string|null} YANG path or null if not found
 */
export function resolveSidToPath(sid, sidInfo) {
  return sidInfo.sidToPath.get(sid) || null;
}

/**
 * Remove module prefixes from a YANG path
 * @param {string} path
 * @returns {string}
 */
function stripPrefixes(path) {
  if (!path) return '';
  return path
    .split('/')
    .map(segment => segment.includes(':') ? segment.split(':')[1] : segment)
    .join('/');
}

/**
 * Resolve identity name to SID (encoding)
 * @param {string} identityName - Identity name (e.g., "ethernetCsmacd")
 * @param {object} sidInfo - SID info from buildSidInfo()
 * @returns {number|null} SID number or null if not found
 */
export function resolveIdentityToSid(identityName, sidInfo) {
  // Remove namespace prefix if present
  const cleanName = identityName.includes(':')
    ? identityName.split(':')[1]
    : identityName;

  return sidInfo.identityToSid.get(cleanName) || null;
}

/**
 * Resolve SID to identity name (decoding)
 * @param {number} sid - SID number
 * @param {object} sidInfo - SID info from buildSidInfo()
 * @returns {string|null} Identity name or null if not found
 */
export function resolveSidToIdentity(sid, sidInfo) {
  return sidInfo.sidToIdentity.get(sid) || null;
}

/**
 * Convert JSON path to YANG path
 * @param {string} jsonPath - JSON dot notation path
 * @returns {string} YANG path with slashes
 */
export function jsonPathToYangPath(jsonPath) {
  // Remove array indices: "interfaces.interface[0].name" → "interfaces.interface.name"
  let path = jsonPath.replace(/\[\d+\]/g, '');

  // Convert dots to slashes: "interfaces.interface.name" → "interfaces/interface/name"
  path = path.replace(/\./g, '/');

  return path;
}

/**
 * Get all SID paths for debugging
 * @param {object} sidInfo - SID info
 * @returns {Array} Array of {path, sid} objects, sorted by SID
 */
export function getAllSidPaths(sidInfo) {
  const paths = [];

  for (const [path, sid] of sidInfo.pathToSid) {
    paths.push({ path, sid });
  }

  // Sort by SID for better readability
  paths.sort((a, b) => a.sid - b.sid);

  return paths;
}

/**
 * Get statistics about SID info
 * @param {object} sidInfo - SID info
 * @returns {object} Statistics
 */
export function getSidInfoStats(sidInfo) {
  return {
    totalPaths: sidInfo.pathToSid.size,
    totalIdentities: sidInfo.identityToSid.size,
    sidRange: {
      min: Math.min(...sidInfo.sidToPath.keys()),
      max: Math.max(...sidInfo.sidToPath.keys())
    }
  };
}

/**
 * Load multiple SID files and merge
 * @param {string[]} sidFilePaths - Array of .sid file paths
 * @returns {Promise<object>} Merged SID info
 */
export async function loadMultipleSidFiles(sidFilePaths) {
  const merged = {
    // BiMap: Path ↔ SID
    pathToSid: new Map(),
    sidToPath: new Map(),
    prefixedPathToSid: new Map(),
    sidToPrefixedPath: new Map(),
    pathToPrefixed: new Map(),

    // BiMap: Identity ↔ SID
    identityToSid: new Map(),
    sidToIdentity: new Map(),

    // Parent-child relationship for Delta-SID
    nodeInfo: new Map(),

    // Index for fuzzy path matching
    leafToPaths: new Map()
  };

  // Load all SID files in parallel
  const sidInfos = await Promise.all(sidFilePaths.map(filePath => buildSidInfo(filePath)));

  sidInfos.forEach(info => {
    // Merge BiMap: Path ↔ SID
    for (const [path, sid] of info.pathToSid) {
      merged.pathToSid.set(path, sid);
    }
    for (const [sid, path] of info.sidToPath) {
      merged.sidToPath.set(sid, path);
    }
    for (const [prefixedPath, sid] of info.prefixedPathToSid) {
      merged.prefixedPathToSid.set(prefixedPath, sid);
    }
    for (const [sid, prefixedPath] of info.sidToPrefixedPath) {
      merged.sidToPrefixedPath.set(sid, prefixedPath);
    }
    for (const [strippedPath, prefixedPath] of info.pathToPrefixed) {
      merged.pathToPrefixed.set(strippedPath, prefixedPath);
    }

    // Merge BiMap: Identity ↔ SID
    for (const [name, sid] of info.identityToSid) {
      merged.identityToSid.set(name, sid);
    }
    for (const [sid, name] of info.sidToIdentity) {
      merged.sidToIdentity.set(sid, name);
    }

    // Merge nodeInfo
    for (const [path, nodeData] of info.nodeInfo) {
      merged.nodeInfo.set(path, nodeData);
    }

    // Merge leafToPaths index
    for (const [leaf, paths] of info.leafToPaths) {
      const existing = merged.leafToPaths.get(leaf) || [];
      merged.leafToPaths.set(leaf, [...new Set([...existing, ...paths])]);
    }
  });

  // Recalculate parent relationships for merged info
  // This is necessary because parent might be from a different module
  for (const [path, sid] of merged.pathToSid) {
    if (path.startsWith('identity:') || path.startsWith('feature:')) {
      continue;
    }

    const parts = path.split('/').filter(p => p);
    let parent = null;

    for (let i = parts.length - 1; i > 0; i--) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (merged.pathToSid.has(ancestorPath)) {
        parent = merged.pathToSid.get(ancestorPath);
        break;
      }
    }

    merged.nodeInfo.set(path, {
      sid,
      parent,
      deltaSid: parent !== null ? sid - parent : sid,
      prefixedPath: merged.pathToPrefixed.get(path) || merged.sidToPrefixedPath.get(sid) || path
    });
  }

  return merged;
}
