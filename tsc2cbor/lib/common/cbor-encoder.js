/**
 * CBOR Encoder Module
 *
 * Encodes data to CBOR format using cbor-x or cbor
 * Optimized for RFC 9254 Delta-SID encoding
 */

import { encode as encodeWithCborX, decode as decodeWithCborX, Tag } from 'cbor-x';
import cbor from 'cbor';

// Export Tag for creating CBOR tags in value-encoder.js
export { Tag };

/**
 * Mark Map/Object as indefinite-length for cbor library
 * This tells cbor library to use indefinite-length encoding (bf...ff) without Tag(259)
 * @param {*} data - Data to mark
 * @returns {*} Data with _indefinite flag
 */
function markIndefinite(data) {
  // Skip primitives
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }

  // Skip Buffers
  if (Buffer.isBuffer(data)) {
    return data;
  }

  // Process arrays recursively
  if (Array.isArray(data)) {
    const processedArray = data.map(item => markIndefinite(item));
    // Set _indefinite as non-enumerable property for arrays too
    Object.defineProperty(processedArray, '_indefinite', {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return processedArray;
  }

  // For Maps and Objects, set _indefinite flag and recursively process values
  if (data instanceof Map) {
    const processedMap = new Map();
    for (const [key, value] of data.entries()) {
      processedMap.set(key, markIndefinite(value));
    }
    // Set _indefinite as non-enumerable property so cbor library reads it but doesn't encode it
    Object.defineProperty(processedMap, '_indefinite', {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return processedMap;
  } else {
    // Plain Object
    const processedObj = {};
    for (const [key, value] of Object.entries(data)) {
      processedObj[key] = markIndefinite(value);
    }
    // Set _indefinite as non-enumerable property
    Object.defineProperty(processedObj, '_indefinite', {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return processedObj;
  }
}

/**
 * Convert string keys to numbers recursively for plain Objects (for cbor-x)
 * This ensures CBOR encodes numeric keys as integers, not strings
 * @param {*} data - Data to process
 * @returns {*} Data with numeric keys converted
 */
function convertNumericKeys(data) {
  // Skip primitives
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }

  // Skip Maps and Buffers (already processed)
  if (data instanceof Map || Buffer.isBuffer(data)) {
    return data;
  }

  // Process arrays recursively
  if (Array.isArray(data)) {
    return data.map(item => convertNumericKeys(item));
  }

  // For plain Objects, convert numeric string keys to numbers
  const result = new Map();
  for (const [key, value] of Object.entries(data)) {
    // Try to parse key as number
    const numKey = Number(key);
    const actualKey = !isNaN(numKey) && String(numKey) === key ? numKey : key;

    // Recursively process nested objects and arrays
    const processedValue = convertNumericKeys(value);
    result.set(actualKey, processedValue);
  }

  return result;
}

/**
 * Encode with indefinite-length maps (manual CBOR construction)
 * This matches yaml2cbor_js approach: 0xBF ... pairs ... 0xFF
 * @param {*} obj - Data to encode
 * @param {string} sortMode - Sort mode: 'velocity' or 'rfc8949'
 * @returns {Buffer} CBOR bytes
 */
function encodeWithIndefinite(obj, sortMode = 'rfc8949') {
  // Primitives and nulls
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return cbor.encode(obj);
  }

  // Buffers
  if (Buffer.isBuffer(obj)) {
    return cbor.encode(obj);
  }

  // Arrays
  if (Array.isArray(obj)) {
    if (obj._indefinite) {
      // Indefinite-length array: 0x9F ... items ... 0xFF
      const items = obj.map(item => encodeWithIndefinite(item, sortMode));
      return Buffer.concat([
        Buffer.from([0x9F]), // Start indefinite array
        ...items,
        Buffer.from([0xFF])  // Break
      ]);
    }
    return cbor.encode(obj.map(item =>
      typeof item === 'object' && item !== null ?
        cbor.decodeFirstSync(encodeWithIndefinite(item, sortMode)) : item
    ));
  }

  // Maps
  if (obj instanceof Map) {
    if (obj._indefinite) {
      // Indefinite-length map: 0xBF ... pairs ... 0xFF
      let entries = Array.from(obj.entries());

      // Only sort for RFC 8949 mode - VelocityDriveSP mode preserves transformer ordering
      if (sortMode === 'rfc8949') {
        entries = entries.sort((a, b) => {
          const keyA = cbor.encode(a[0]);
          const keyB = cbor.encode(b[0]);
          return Buffer.compare(keyA, keyB);
        });
      }

      const pairs = [];
      for (const [key, value] of entries) {
        pairs.push(cbor.encode(key));
        pairs.push(encodeWithIndefinite(value, sortMode));
      }
      return Buffer.concat([
        Buffer.from([0xBF]), // Start indefinite map
        ...pairs,
        Buffer.from([0xFF])  // Break
      ]);
    }

    // Regular map (shouldn't happen in compatible mode)
    const regularMap = new Map();
    for (const [key, value] of obj.entries()) {
      regularMap.set(key,
        typeof value === 'object' && value !== null ?
          cbor.decodeFirstSync(encodeWithIndefinite(value, sortMode)) : value
      );
    }
    return cbor.encode(regularMap);
  }

  // Plain objects
  if (obj._indefinite) {
    // Convert Object to Map entries for indefinite encoding
    let entries = Object.entries(obj);

    // Only sort for RFC 8949 mode - VelocityDriveSP mode preserves transformer ordering
    if (sortMode === 'rfc8949') {
      entries = entries.sort((a, b) => {
        const keyA = cbor.encode(a[0]);
        const keyB = cbor.encode(b[0]);
        return Buffer.compare(keyA, keyB);
      });
    }

    const pairs = [];
    for (const [key, value] of entries) {
      pairs.push(cbor.encode(key));
      pairs.push(encodeWithIndefinite(value, sortMode));
    }
    return Buffer.concat([
      Buffer.from([0xBF]), // Start indefinite map
      ...pairs,
      Buffer.from([0xFF])  // Break
    ]);
  }

  return cbor.encode(obj);
}

/**
 * Encode data to CBOR
 * @param {*} data - Data to encode (Map or plain Object)
 * @param {object} options - Encoding options
 * @param {boolean} options.useCompatible - Use cbor library (no Tag 259, indefinite-length)
 * @param {string} options.sortMode - Sort mode: 'velocity' or 'rfc8949'
 * @returns {Buffer} CBOR binary data
 */
export function encodeToCbor(data, options = {}) {
  try {
    const sortMode = options.sortMode || 'rfc8949';

    if (options.useCompatible) {
      // Compatible mode: Manual CBOR construction with indefinite-length encoding
      // This produces CBOR without Tag(259), matching VelocityDriveSP output
      const markedData = markIndefinite(data);
      return encodeWithIndefinite(markedData, sortMode);
    } else {
      // Normal mode: Use cbor-x with Tag(259) for better roundtrip support
      // Convert plain Objects with numeric string keys to Maps with numeric keys
      // This ensures cbor-x encodes them as CBOR integers, not text strings
      const processedData = (data && typeof data === 'object' && !(data instanceof Map))
        ? convertNumericKeys(data)
        : data;

      return encodeWithCborX(processedData, {
        useRecords: options.useRecords || false,
        structuredClone: options.structuredClone || false,
        variableMapSize: options.variableMapSize !== false, // Default true
        ...options
      });
    }
  } catch (error) {
    throw new Error(`CBOR encoding error: ${error.message}`);
  }
}

/**
 * Decode CBOR to data
 * @param {Buffer} cborBuffer - CBOR binary data
 * @param {object} options - Decoding options
 * @returns {*} Decoded data
 */
export function decodeFromCbor(cborBuffer, options = {}) {
  try {
    // Use cbor-x for decoding (supports both Tag 259 and regular maps)
    const data = decodeWithCborX(cborBuffer, options);
    return data;
  } catch (error) {
    throw new Error(`CBOR decoding error: ${error.message}`);
  }
}

/**
 * Get CBOR diagnostic notation
 * @param {Buffer} cborBuffer - CBOR binary data
 * @returns {string} Diagnostic notation
 */
export function getCborDiagnostic(cborBuffer) {
  try {
    // Decode and format as JSON-like notation
    const data = decode(cborBuffer);
    return formatDiagnostic(data, cborBuffer);
  } catch (error) {
    throw new Error(`Diagnostic generation error: ${error.message}`);
  }
}

/**
 * Format diagnostic notation
 * @param {*} data - Decoded data
 * @param {Buffer} cborBuffer - Original CBOR buffer
 * @returns {string} Formatted diagnostic
 */
function formatDiagnostic(data, cborBuffer) {
  const hex = cborBuffer.toString('hex');
  const hexFormatted = hex.match(/.{1,2}/g).join(' ');

  return `
=== CBOR Diagnostic ===
Hex: ${hexFormatted}
Size: ${cborBuffer.length} bytes

Decoded:
${JSON.stringify(data, null, 2)}
`;
}

/**
 * Calculate compression ratio
 * @param {number} originalSize - Original data size (JSON/YAML)
 * @param {number} cborSize - CBOR size
 * @returns {object} Compression statistics
 */
export function calculateCompressionRatio(originalSize, cborSize) {
  const ratio = ((originalSize - cborSize) / originalSize * 100).toFixed(2);
  const compressionFactor = (originalSize / cborSize).toFixed(2);

  return {
    originalSize,
    cborSize,
    savedBytes: originalSize - cborSize,
    compressionRatio: `${ratio}%`,
    compressionFactor: `${compressionFactor}x`
  };
}

/**
 * Validate CBOR encoding
 * @param {Buffer} cborBuffer - CBOR binary data
 * @returns {boolean} True if valid
 */
export function validateCbor(cborBuffer) {
  try {
    decode(cborBuffer);
    return true;
  } catch (error) {
    console.error('CBOR validation error:', error.message);
    return false;
  }
}

/**
 * Encode with indefinite length (streaming)
 * @param {Array|object} data - Data to encode
 * @returns {Buffer} CBOR with indefinite length encoding
 */
export function encodeIndefinite(data) {
  // cbor-x automatically uses indefinite length for streaming
  return encodeToCbor(data, {
    useRecords: false,
    variableMapSize: true
  });
}

/**
 * Get CBOR size
 * @param {*} data - Data to measure
 * @returns {number} Size in bytes after CBOR encoding
 */
export function getCborSize(data) {
  const cbor = encodeToCbor(data);
  return cbor.length;
}

/**
 * Compare two CBOR encodings
 * @param {Buffer} cbor1 - First CBOR buffer
 * @param {Buffer} cbor2 - Second CBOR buffer
 * @returns {object} Comparison results
 */
export function compareCbor(cbor1, cbor2) {
  const data1 = decode(cbor1);
  const data2 = decode(cbor2);

  return {
    size1: cbor1.length,
    size2: cbor2.length,
    sizeDiff: cbor2.length - cbor1.length,
    dataEqual: JSON.stringify(data1) === JSON.stringify(data2)
  };
}

/**
 * Optimize CBOR encoding
 * @param {*} data - Data to encode
 * @returns {Buffer} Optimized CBOR
 */
export function optimizeCbor(data) {
  // Use cbor-x's record structure for optimization
  return encodeToCbor(data, {
    useRecords: true,
    structuredClone: false,
    variableMapSize: true
  });
}

/**
 * Get encoding statistics (simplified version)
 * @param {*} jsObject - JavaScript object before encoding
 * @param {Buffer} cborBuffer - CBOR buffer after encoding
 * @returns {object} Statistics
 */
export function getEncodingStats(jsObject, cborBuffer) {
  const jsonSize = JSON.stringify(jsObject).length;
  const cborSize = cborBuffer.length;

  return {
    jsonSize,
    cborSize,
    compressionRatio: cborSize / jsonSize,
    savedBytes: jsonSize - cborSize,
    savedPercent: ((1 - cborSize / jsonSize) * 100).toFixed(1)
  };
}

/**
 * Verify round-trip: encode → decode → compare
 * @param {*} data - Original data
 * @returns {object} Verification result
 */
export function verifyRoundTrip(data) {
  const encoded = encodeToCbor(data);
  const decoded = decodeFromCbor(encoded);

  const originalJson = JSON.stringify(data);
  const decodedJson = JSON.stringify(decoded);

  return {
    success: originalJson === decodedJson,
    original: data,
    encoded: encoded,
    decoded: decoded,
    encodedSize: encoded.length
  };
}
