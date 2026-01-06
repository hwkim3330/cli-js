/**
 * Input Loader - Common module for loading YANG/SID inputs
 *
 * This module extracts the shared loadInputs logic from both
 * tsc2cbor.js and cbor2tsc.js to eliminate code duplication.
 *
 * Supports pre-compiled cache for fast loading.
 *
 * @module input-loader
 */

import { buildSidInfo } from './sid-resolver.js';
import { extractYangTypes } from './yang-type-extractor.js';
import fs from 'fs';
import path from 'path';

// Cache version - increment when cache format changes
const CACHE_VERSION = 4;

/**
 * Get cache file path for a YANG cache directory
 */
function getCacheFilePath(yangCacheDir) {
  const dirName = path.basename(yangCacheDir);
  return path.join(path.dirname(yangCacheDir), `${dirName}.cache.json`);
}

/**
 * Check if cache is valid (exists and newer than source files)
 */
async function isCacheValid(cacheFile, yangCacheDir) {
  try {
    const cacheStat = await fs.promises.stat(cacheFile);
    const cacheTime = cacheStat.mtimeMs;

    // Check if any source file is newer than cache
    const files = await fs.promises.readdir(yangCacheDir);
    for (const file of files) {
      if (file.endsWith('.yang') || file.endsWith('.sid')) {
        const fileStat = await fs.promises.stat(path.join(yangCacheDir, file));
        if (fileStat.mtimeMs > cacheTime) {
          return false; // Source file is newer
        }
      }
    }
    return true;
  } catch {
    return false; // Cache doesn't exist
  }
}

/**
 * Serialize Maps and Sets to JSON-compatible format
 */
function serializeData(sidInfo, typeTable) {
  return {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    sidInfo: {
      pathToSid: [...sidInfo.pathToSid],
      sidToPath: [...sidInfo.sidToPath],
      prefixedPathToSid: [...sidInfo.prefixedPathToSid],
      sidToPrefixedPath: [...sidInfo.sidToPrefixedPath],
      pathToPrefixed: [...sidInfo.pathToPrefixed],
      identityToSid: [...sidInfo.identityToSid],
      sidToIdentity: [...sidInfo.sidToIdentity],
      nodeInfo: [...sidInfo.nodeInfo],
      leafToPaths: [...sidInfo.leafToPaths]
    },
    typeTable: {
      types: [...typeTable.types].map(([k, v]) => [k, serializeTypeInfo(v)]),
      typedefs: [...typeTable.typedefs].map(([k, v]) => [k, serializeTypeInfo(v)]),
      nodeOrders: [...typeTable.nodeOrders]
    }
  };
}

/**
 * Serialize type info (handle nested Maps)
 */
function serializeTypeInfo(typeInfo) {
  if (!typeInfo) return typeInfo;
  const result = { ...typeInfo };
  if (typeInfo.enum) {
    result.enum = {
      nameToValue: [...typeInfo.enum.nameToValue],
      valueToName: [...typeInfo.enum.valueToName]
    };
  }
  return result;
}

/**
 * Deserialize JSON data back to Maps and Sets
 */
function deserializeData(data) {
  if (data.version !== CACHE_VERSION) {
    throw new Error('Cache version mismatch');
  }

  const sidInfo = {
    pathToSid: new Map(data.sidInfo.pathToSid),
    sidToPath: new Map(data.sidInfo.sidToPath),
    prefixedPathToSid: new Map(data.sidInfo.prefixedPathToSid),
    sidToPrefixedPath: new Map(data.sidInfo.sidToPrefixedPath),
    pathToPrefixed: new Map(data.sidInfo.pathToPrefixed),
    identityToSid: new Map(data.sidInfo.identityToSid),
    sidToIdentity: new Map(data.sidInfo.sidToIdentity),
    nodeInfo: new Map(data.sidInfo.nodeInfo),
    leafToPaths: new Map(data.sidInfo.leafToPaths)
  };

  const typeTable = {
    types: new Map(data.typeTable.types.map(([k, v]) => [k, deserializeTypeInfo(v)])),
    typedefs: new Map(data.typeTable.typedefs.map(([k, v]) => [k, deserializeTypeInfo(v)])),
    nodeOrders: new Map(data.typeTable.nodeOrders)
  };

  return { sidInfo, typeTable };
}

/**
 * Deserialize type info
 */
function deserializeTypeInfo(typeInfo) {
  if (!typeInfo) return typeInfo;
  const result = { ...typeInfo };
  if (typeInfo.enum) {
    result.enum = {
      nameToValue: new Map(typeInfo.enum.nameToValue),
      valueToName: new Map(typeInfo.enum.valueToName)
    };
  }
  return result;
}

/**
 * Load from cache file
 */
async function loadFromCache(cacheFile, verbose) {
  const data = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
  const result = deserializeData(data);

  if (verbose) {
    const sidCount = result.sidInfo.pathToSid.size;
    const typeCount = result.typeTable.types.size;
    console.log(`  Loaded from cache: ${sidCount} SIDs, ${typeCount} types`);
  }

  return result;
}

/**
 * Save to cache file
 */
async function saveToCache(cacheFile, sidInfo, typeTable, verbose) {
  const data = serializeData(sidInfo, typeTable);
  await fs.promises.writeFile(cacheFile, JSON.stringify(data), 'utf8');

  if (verbose) {
    const stat = await fs.promises.stat(cacheFile);
    console.log(`  Cache saved: ${(stat.size / 1024).toFixed(1)} KB`);
  }
}

/**
 * Load and merge YANG/SID inputs from cache directory
 *
 * Uses pre-compiled cache if available for fast loading.
 *
 * @param {string} yangCacheDir - Directory containing .yang and .sid files
 * @param {boolean} verbose - Enable verbose logging
 * @param {object} options - Additional options
 * @param {boolean} options.noCache - Disable cache (force reload)
 * @returns {Promise<{sidInfo: object, typeTable: object}>}
 */
export async function loadYangInputs(yangCacheDir, verbose = false, options = {}) {
  const cacheFile = getCacheFilePath(yangCacheDir);

  // Try to load from cache first (unless disabled)
  if (!options.noCache && await isCacheValid(cacheFile, yangCacheDir)) {
    if (verbose) {
      console.log('Loading YANG/SID from cache...');
    }
    try {
      return await loadFromCache(cacheFile, verbose);
    } catch (err) {
      if (verbose) {
        console.log(`  Cache load failed: ${err.message}, rebuilding...`);
      }
    }
  }

  if (verbose) {
    console.log('Loading YANG/SID inputs...');
  }

  // Step 1: Load all SID files from cache directory (async)
  const allFiles = await fs.promises.readdir(yangCacheDir);
  const sidFiles = allFiles
    .filter(f => f.endsWith('.sid'))
    .map(f => path.join(yangCacheDir, f));

  if (verbose) {
    console.log(`  - Found ${sidFiles.length} SID files`);
  }

  // Step 2: Initialize merged SID info structure
  const sidInfo = {
    pathToSid: new Map(),
    sidToPath: new Map(),
    prefixedPathToSid: new Map(),
    sidToPrefixedPath: new Map(),
    pathToPrefixed: new Map(),
    identityToSid: new Map(),
    sidToIdentity: new Map(),
    nodeInfo: new Map(),
    leafToPaths: new Map()
  };

  // Load all SID files in parallel for better performance
  const sidInfos = await Promise.all(sidFiles.map(sidFile => buildSidInfo(sidFile)));

  // Merge all SID infos
  for (const info of sidInfos) {
    for (const [path, sid] of info.pathToSid) {
      sidInfo.pathToSid.set(path, sid);
    }
    for (const [sid, path] of info.sidToPath) {
      sidInfo.sidToPath.set(sid, path);
    }
    for (const [prefixedPath, sid] of info.prefixedPathToSid) {
      sidInfo.prefixedPathToSid.set(prefixedPath, sid);
    }
    for (const [sid, prefixedPath] of info.sidToPrefixedPath) {
      sidInfo.sidToPrefixedPath.set(sid, prefixedPath);
    }
    for (const [strippedPath, prefixedPath] of info.pathToPrefixed) {
      sidInfo.pathToPrefixed.set(strippedPath, prefixedPath);
    }
    for (const [identity, sid] of info.identityToSid) {
      sidInfo.identityToSid.set(identity, sid);
    }
    for (const [sid, identity] of info.sidToIdentity) {
      sidInfo.sidToIdentity.set(sid, identity);
    }
    // Merge leafToPaths index for fuzzy matching
    for (const [leaf, paths] of info.leafToPaths) {
      const existing = sidInfo.leafToPaths.get(leaf) || [];
      sidInfo.leafToPaths.set(leaf, [...new Set([...existing, ...paths])]);
    }
  }

  // Step 3: Recalculate parent relationships for merged info
  // This is necessary because parent might be from a different module
  for (const [nodePath, sid] of sidInfo.pathToSid) {
    if (nodePath.startsWith('identity:') || nodePath.startsWith('feature:')) {
      continue;
    }

    const parts = nodePath.split('/').filter(p => p);
    let parent = null;

    for (let i = parts.length - 1; i > 0; i--) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (sidInfo.pathToSid.has(ancestorPath)) {
        parent = sidInfo.pathToSid.get(ancestorPath);
        break;
      }
    }

    sidInfo.nodeInfo.set(nodePath, {
      sid,
      parent,
      deltaSid: parent !== null ? sid - parent : sid,
      prefixedPath: sidInfo.pathToPrefixed.get(nodePath) || sidInfo.sidToPrefixedPath.get(sid) || nodePath
    });
  }

  // Step 4: Load all YANG files from cache directory
  const yangFiles = allFiles
    .filter(f => f.endsWith('.yang'))
    .map(f => path.join(yangCacheDir, f));

  if (verbose) {
    console.log(`  - Found ${yangFiles.length} YANG files`);
  }

  // Step 5: Initialize merged type table structure
  const typeTable = {
    types: new Map(),
    typedefs: new Map(),
    nodeOrders: new Map()
  };

  // Load all YANG files in parallel for better performance
  const typeTables = await Promise.all(
    yangFiles.map(yangFile => extractYangTypes(yangFile, yangCacheDir))
  );

  // Merge all type tables
  for (const table of typeTables) {
    for (const [path, type] of table.types) {
      typeTable.types.set(path, type);
    }
    for (const [name, typedef] of table.typedefs) {
      typeTable.typedefs.set(name, typedef);
    }
    if (table.nodeOrders) {
      for (const [nodeName, order] of table.nodeOrders) {
        typeTable.nodeOrders.set(nodeName, order);
      }
    }
  }

  // Step 6: Merge vendor-prefixed typedefs into base typedefs
  const mergedTypedefs = new Set();
  for (const [name, typedef] of typeTable.typedefs) {
    const vendorPrefixes = ['velocitysp-', 'mchp-'];
    for (const prefix of vendorPrefixes) {
      if (name.startsWith(prefix)) {
        const baseName = name.substring(prefix.length);
        const baseTypedef = typeTable.typedefs.get(baseName);

        if (baseTypedef && baseTypedef.enum && typedef.enum) {
          const mergedEnum = {
            nameToValue: new Map([...baseTypedef.enum.nameToValue, ...typedef.enum.nameToValue]),
            valueToName: new Map([...baseTypedef.enum.valueToName, ...typedef.enum.valueToName])
          };
          typeTable.typedefs.set(baseName, {
            ...typedef,
            enum: mergedEnum,
            original: baseName
          });
          mergedTypedefs.add(baseName);
          if (verbose) {
            console.log(`  - Merged ${name} into ${baseName} (${mergedEnum.nameToValue.size} enum values)`);
          }
        }
      }
    }
  }

  // Update leaf types that use merged typedefs
  for (const [path, typeInfo] of typeTable.types) {
    if (typeInfo.original && mergedTypedefs.has(typeInfo.original)) {
      const mergedTypedef = typeTable.typedefs.get(typeInfo.original);
      typeTable.types.set(path, {
        ...mergedTypedef,
        original: typeInfo.original
      });
    }
  }

  if (verbose) {
    const sidCount = sidInfo.pathToSid.size;
    const typeCount = typeTable.types.size;

    let enumCount = 0;
    for (const typeInfo of typeTable.types.values()) {
      if (typeInfo.type === 'enumeration' && typeInfo.enum) {
        enumCount++;
      }
    }

    console.log(`  Loaded: ${sidCount} SID mappings`);
    console.log(`  Loaded: ${typeCount} types (${enumCount} enums)`);
  }

  // Step 8: Save to cache for future fast loading
  if (!options.noCache) {
    try {
      await saveToCache(cacheFile, sidInfo, typeTable, verbose);
    } catch (err) {
      // Cache save failure is not critical
      if (verbose) {
        console.log(`  Warning: Failed to save cache: ${err.message}`);
      }
    }
  }

  return { sidInfo, typeTable };
}
