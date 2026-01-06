/**
 * YANG Type Extractor Module
 *
 * Extracts type information from YANG files using pyang → YIN → xml2js
 * Based on VelocityDriveSP architecture
 */

import { execSync } from 'child_process';
import xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Detect pyang command - Windows may need full path
function getPyangCommand() {
  if (os.platform() === 'win32') {
    const pythonPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'pyang.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'pyang.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'pyang.exe'),
    ];
    for (const p of pythonPaths) {
      if (fs.existsSync(p)) return '"' + p + '"';
    }
  }
  return 'pyang';
}



/**
 * Extract type information from YANG file
 * @param {string} yangFilePath - Path to .yang file
 * @param {string} yangSearchPath - Directory containing imported YANG modules
 * @returns {Promise<object>} Type table {path → typeInfo}
 */
export async function extractYangTypes(yangFilePath, yangSearchPath = null) {
  try {
    // 1. pyang → YIN (XML)
    const yin = yangToYin(yangFilePath, yangSearchPath);

    // 2. xml2js → JavaScript Object
    const yinObj = await yinToJson(yin);

    // 3. Extract type information
    const typeTable = extractTypesFromYin(yinObj);

    return typeTable;

  } catch (error) {
    throw new Error(`YANG type extraction failed: ${error.message}`);
  }
}

/**
 * Convert YANG to YIN (XML) using pyang
 * @param {string} yangFilePath - Path to .yang file
 * @param {string} yangSearchPath - Directory for imports
 * @returns {string} YIN XML content
 */
function yangToYin(yangFilePath, yangSearchPath) {
  const searchPathOption = yangSearchPath ? `-p ${yangSearchPath}` : '';

  try {
    const command = `${getPyangCommand()} -f yin ${searchPathOption} ${yangFilePath}`;
    const yin = execSync(command, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    return yin;

  } catch (error) {
    // pyang not found or parsing error
    if (error.message.includes('pyang')) {
      throw new Error('pyang not found. Install: pip install pyang');
    }
    throw new Error(`pyang failed: ${error.stderr || error.message}`);
  }
}

/**
 * Parse YIN (XML) to JavaScript Object
 * @param {string} yin - YIN XML content
 * @returns {Promise<object>} Parsed YIN object
 */
async function yinToJson(yin) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    normalizeTags: false
  });

  try {
    const yinObj = await parser.parseStringPromise(yin);
    return yinObj;
  } catch (error) {
    throw new Error(`YIN parsing failed: ${error.message}`);
  }
}

/**
 * Extract type information from YIN object
 * @param {object} yinObj - Parsed YIN object
 * @returns {object} Type table
 */
function extractTypesFromYin(yinObj) {
  const typeTable = {
    // BiMap: Path → Type Info (typeInfo.enum contains BiMap if enumeration)
    types: new Map(),                // path → type info

    // Typedefs
    typedefs: new Map(),             // typedef name → type definition

    // Node order (for VelocityDriveSP sorting)
    // Map: local node name → order (within module)
    nodeOrders: new Map()            // localName → order
  };

  // Get module or submodule
  const module = yinObj.module || yinObj.submodule;
  if (!module) {
    throw new Error('Invalid YIN: no module or submodule found');
  }

  const moduleName = module.name;
  const namespace = module.namespace?.uri || '';

  // Extract typedefs
  if (module.typedef) {
    const typedefs = Array.isArray(module.typedef) ? module.typedef : [module.typedef];
    typedefs.forEach(typedef => {
      extractTypedef(typedef, typeTable);
    });
  }

  // Initialize order counter
  typeTable._orderCounter = 0;

  // Extract container/list/leaf types
  extractDataTypes(module, '', typeTable, moduleName);

  // Remove internal counter before returning
  delete typeTable._orderCounter;

  return typeTable;
}

/**
 * Extract typedef information
 */
function extractTypedef(typedef, typeTable) {
  const typedefName = typedef.name;
  const typeNode = typedef.type;

  if (!typeNode) return;

  const typeInfo = parseTypeNode(typeNode);
  typeTable.typedefs.set(typedefName, typeInfo);

  // Note: Enum BiMap is already stored in typeInfo.enum by parseTypeNode()
  // No need for separate typeTable.enums structure
}

/**
 * Extract data types from container/list/leaf nodes
 */
function extractDataTypes(node, currentPath, typeTable, moduleName, depth = 0) {
  if (depth > 20) return; // Prevent infinite recursion

  // Extract from container
  if (node.container) {
    const containers = Array.isArray(node.container) ? node.container : [node.container];
    containers.forEach(container => {
      const containerName = container.name;
      const newPath = currentPath ? `${currentPath}/${containerName}` : containerName;

      // Record node order
      if (!typeTable.nodeOrders.has(containerName)) {
        typeTable.nodeOrders.set(containerName, typeTable._orderCounter++);
      }

      extractDataTypes(container, newPath, typeTable, moduleName, depth + 1);
    });
  }

  // Extract from list
  if (node.list) {
    const lists = Array.isArray(node.list) ? node.list : [node.list];
    lists.forEach(list => {
      const listName = list.name;
      const newPath = currentPath ? `${currentPath}/${listName}` : listName;

      // Record node order
      if (!typeTable.nodeOrders.has(listName)) {
        typeTable.nodeOrders.set(listName, typeTable._orderCounter++);
      }

      extractDataTypes(list, newPath, typeTable, moduleName, depth + 1);
    });
  }

  // Extract from choice / case (alias metadata + nested nodes)
  if (node.choice) {
    const choices = Array.isArray(node.choice) ? node.choice : [node.choice];
    choices.forEach(choiceNode => {
      processChoiceNode(choiceNode, currentPath, typeTable, moduleName, depth + 1);
    });
  }

  // Extract from leaf
  if (node.leaf) {
    const leafs = Array.isArray(node.leaf) ? node.leaf : [node.leaf];
    leafs.forEach(leaf => {
      const leafName = leaf.name;
      const leafPath = currentPath ? `${currentPath}/${leafName}` : leafName;

      // Record node order
      if (!typeTable.nodeOrders.has(leafName)) {
        typeTable.nodeOrders.set(leafName, typeTable._orderCounter++);
      }

      if (leaf.type) {
        let typeInfo = parseTypeNode(leaf.type);

        // CRITICAL FIX: Resolve typedef to get actual type information
        // If type is a typedef name (not a built-in type), resolve it
        if (typeInfo.type && !typeInfo.enum && !typeInfo.bits && !typeInfo.base &&
            !['enumeration', 'identityref', 'decimal64', 'bits', 'union', 'binary', 'boolean', 'string',
              'uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64'].includes(typeInfo.type)) {
          // This might be a typedef - check typeTable.typedefs
          const typedef = typeTable.typedefs.get(typeInfo.type);
          if (typedef) {
            // Merge typedef info into typeInfo, keeping original type name
            typeInfo = {
              ...typedef,
              original: typeInfo.type  // Keep original typedef name
            };
          }
        }

        typeTable.types.set(leafPath, typeInfo);

        // Note: Enum BiMap is already stored in typeInfo.enum by parseTypeNode()
      }
    });
  }

  // Extract from leaf-list
  if (node['leaf-list']) {
    const leafLists = Array.isArray(node['leaf-list']) ? node['leaf-list'] : [node['leaf-list']];
    leafLists.forEach(leafList => {
      const leafListName = leafList.name;
      const leafListPath = currentPath ? `${currentPath}/${leafListName}` : leafListName;

      // Record node order
      if (!typeTable.nodeOrders.has(leafListName)) {
        typeTable.nodeOrders.set(leafListName, typeTable._orderCounter++);
      }

      if (leafList.type) {
        let typeInfo = parseTypeNode(leafList.type);

        // CRITICAL FIX: Resolve typedef to get actual type information
        if (typeInfo.type && !typeInfo.enum && !typeInfo.bits && !typeInfo.base &&
            !['enumeration', 'identityref', 'decimal64', 'bits', 'union', 'binary', 'boolean', 'string',
              'uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64'].includes(typeInfo.type)) {
          const typedef = typeTable.typedefs.get(typeInfo.type);
          if (typedef) {
            typeInfo = {
              ...typedef,
              original: typeInfo.type
            };
          }
        }

        typeTable.types.set(leafListPath, typeInfo);

        // Note: Enum BiMap is already stored in typeInfo.enum by parseTypeNode()
      }
    });
  }

  // Extract from grouping (for completeness)
  if (node.grouping) {
    const groupings = Array.isArray(node.grouping) ? node.grouping : [node.grouping];
    groupings.forEach(grouping => {
      extractDataTypes(grouping, currentPath, typeTable, moduleName, depth + 1);
    });
  }
}

/**
 * Process YIN choice node and recurse into children
 */
function processChoiceNode(choiceNode, currentPath, typeTable, moduleName, depth) {
  if (!choiceNode) return;

  // Handle explicit cases
  if (choiceNode.case) {
    const cases = Array.isArray(choiceNode.case) ? choiceNode.case : [choiceNode.case];
    cases.forEach(caseNode => {
      extractDataTypes(caseNode, currentPath, typeTable, moduleName, depth + 1);
    });
  }

  // Handle nodes directly under choice (leaf, container, list, nested choice, uses)
  const directKeys = ['container', 'list', 'leaf', 'leaf-list', 'choice'];
  directKeys.forEach(key => {
    if (!choiceNode[key]) return;
    const elements = Array.isArray(choiceNode[key]) ? choiceNode[key] : [choiceNode[key]];
    elements.forEach(element => {
      extractDataTypes(element, currentPath, typeTable, moduleName, depth + 1);
    });
  });
}

/**
 * Parse type node to extract type information
 */
function parseTypeNode(typeNode) {
  const typeName = typeNode.name;

  const typeInfo = {
    type: typeName,
    original: typeName
  };

  // Handle enumeration - BiMap for O(1) bidirectional lookup
  if (typeName === 'enumeration' && typeNode.enum) {
    const enums = Array.isArray(typeNode.enum) ? typeNode.enum : [typeNode.enum];

    const nameToValue = new Map();
    const valueToName = new Map();

    enums.forEach((enumItem, index) => {
      const enumName = enumItem.name;
      const enumValue = enumItem.value?.value !== undefined
        ? parseInt(enumItem.value.value)
        : index;

      nameToValue.set(enumName, enumValue);
      valueToName.set(enumValue, enumName);
    });

    // Store as BiMap for O(1) encoding/decoding
    typeInfo.enum = { nameToValue, valueToName };
  }

  // Handle decimal64
  if (typeName === 'decimal64') {
    const fractionDigits = typeNode['fraction-digits']?.value;
    typeInfo.fractionDigits = fractionDigits ? parseInt(fractionDigits) : 2;
  }

  // Handle identityref
  if (typeName === 'identityref') {
    typeInfo.base = typeNode.base?.name || null;
  }

  // Handle bits
  if (typeName === 'bits' && typeNode.bit) {
    const bits = Array.isArray(typeNode.bit) ? typeNode.bit : [typeNode.bit];
    typeInfo.bits = {};

    bits.forEach((bitItem, index) => {
      const bitName = bitItem.name;
      const bitPosition = bitItem.position?.value !== undefined
        ? parseInt(bitItem.position.value)
        : index;
      typeInfo.bits[bitName] = bitPosition;
    });
  }

  // Handle range
  if (typeNode.range?.value) {
    typeInfo.range = typeNode.range.value;
  }

  // Handle length
  if (typeNode.length?.value) {
    typeInfo.length = typeNode.length.value;
  }

  // Handle pattern
  if (typeNode.pattern?.value) {
    typeInfo.pattern = typeNode.pattern.value;
  }

  // Handle union
  if (typeName === 'union' && typeNode.type) {
    const unionTypes = Array.isArray(typeNode.type) ? typeNode.type : [typeNode.type];
    typeInfo.unionTypes = unionTypes.map(t => parseTypeNode(t));
  }

  return typeInfo;
}

/**
 * Load multiple YANG files and merge type tables
 * @param {string[]} yangFiles - Array of YANG file paths
 * @param {string} yangSearchPath - Directory for imports
 * @returns {Promise<object>} Merged type table
 */
export async function extractMultipleYangTypes(yangFiles, yangSearchPath) {
  const typeTables = await Promise.all(
    yangFiles.map(file => extractYangTypes(file, yangSearchPath))
  );

  // Merge all type tables
  const merged = {
    types: new Map(),
    typedefs: new Map()
  };

  typeTables.forEach(table => {
    // Merge types (typeInfo.enum already contains BiMap if enumeration)
    for (const [path, typeInfo] of table.types) {
      merged.types.set(path, typeInfo);
    }

    // Merge typedefs
    for (const [typedefName, typeInfo] of table.typedefs) {
      merged.typedefs.set(typedefName, typeInfo);
    }
  });

  return merged;
}

/**
 * Get type info for a specific YANG path (encoding)
 * @param {string} yangPath - YANG path (e.g., "interfaces/interface/type")
 * @param {object} typeTable - Type table from extractYangTypes()
 * @returns {object|null} Type info or null if not found
 */
export function getTypeForPath(yangPath, typeTable) {
  return typeTable.types.get(yangPath) || null;
}

// Note: Enum BiMap is now stored directly in typeInfo.enum
// Use typeInfo.enum.nameToValue and typeInfo.enum.valueToName for encoding/decoding
