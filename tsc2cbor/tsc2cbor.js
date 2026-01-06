/**
 * TSC2CBOR - TSN Switch Configuration to CBOR Converter
 *
 * Pure library module for YAML → CBOR conversion
 * Converts TSC YAML to CBOR with RFC 9254 Delta-SID encoding
 *
 * Full Pipeline:
 * 1. YANG → Type Table (yang-type-extractor.js)
 * 2. SID File → SID Tree (sid-resolver.js)
 * 3. YAML → JSON (js-yaml)
 * 4. JSON → Delta-SID Object (transformer.js)
 * 5. JavaScript Object → CBOR Binary (cbor-encoder.js)
 */

import yaml from 'js-yaml';
import { loadYangInputs } from './lib/common/input-loader.js';
import { transform, getTransformStats } from './lib/encoder/transformer-delta.js';
import {
  transformInstanceIdentifier,
  isInstanceIdentifierFormat,
  getInstanceIdTransformStats
} from './lib/encoder/transformer-instance-id.js';
import {
  encodeToCbor,
  decodeFromCbor,
  getEncodingStats,
  getCborDiagnostic,
  verifyRoundTrip
} from './lib/common/cbor-encoder.js';
import { getDeltaSidStats } from './lib/encoder/delta-sid-encoder.js';
import fs from 'fs';
import path from 'path';

/**
 * Main conversion class
 *
 * @example
 * const converter = new Tsc2CborConverter('/path/to/.yang-cache');
 * const result = await converter.convertFile('config.yaml', {
 *   outputFile: 'output.cbor',
 *   verbose: true
 * });
 */
class Tsc2CborConverter {
  /**
   * Create a new converter
   * @param {string} yangCacheDir - Directory containing .yang and .sid files
   */
  constructor(yangCacheDir) {
    if (!yangCacheDir) {
      throw new Error('yangCacheDir is required');
    }

    this.yangCacheDir = yangCacheDir;
    this.sidInfo = null;
    this.typeTable = null;
    this.cacheLoaded = false;
  }

  /**
   * Load YANG/SID inputs (lazy loading, only once)
   * @private
   */
  async loadInputs(verbose = false) {
    if (this.cacheLoaded) return;

    const { sidInfo, typeTable } = await loadYangInputs(this.yangCacheDir, verbose);
    this.sidInfo = sidInfo;
    this.typeTable = typeTable;
    this.cacheLoaded = true;
  }

  /**
   * Convert YAML file to CBOR
   * @param {string} yamlPath - Path to YAML file
   * @param {object} options - Conversion options
   * @param {string} [options.outputFile] - Output CBOR file path (optional)
   * @param {boolean} [options.verbose=false] - Verbose output
   * @param {boolean} [options.compatible=true] - Compatible mode (indefinite-length, no Tag 259)
   * @param {string} [options.sortMode='velocity'] - Sort mode: 'velocity' or 'rfc8949'
   * @param {boolean} [options.diagnostic=false] - Generate diagnostic output
   * @param {boolean} [options.validate=false] - Validate round-trip
   * @returns {Promise<{cbor: Buffer, jsonData: object, transformed: Map, stats: object}>}
   */
  async convertFile(yamlPath, options = {}) {
    const verbose = options.verbose || false;

    // Load YANG/SID inputs (cached after first call)
    await this.loadInputs(verbose);

    if (verbose) {
      console.log(`\nLoading YAML file: ${yamlPath}`);
    }

    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    return this.convertString(yamlContent, options);
  }

  /**
   * Convert YAML string to CBOR
   * @param {string} yamlString - YAML content as string
   * @param {object} options - Conversion options
   * @param {string} [options.outputFile] - Output CBOR file path (optional)
   * @param {boolean} [options.verbose=false] - Verbose output
   * @param {boolean} [options.compatible=true] - Compatible mode (indefinite-length, no Tag 259)
   * @param {string} [options.sortMode='velocity'] - Sort mode: 'velocity' or 'rfc8949'
   * @param {boolean} [options.diagnostic=false] - Generate diagnostic output
   * @param {boolean} [options.validate=false] - Validate round-trip
   * @returns {Promise<{cbor: Buffer, jsonData: object, transformed: Map, stats: object}>}
   */
  async convertString(yamlString, options = {}) {
    const verbose = options.verbose || false;
    const compatible = options.compatible !== false;
    const sortMode = options.sortMode || 'velocity';
    const outputFile = options.outputFile || null;
    const diagnostic = options.diagnostic || false;
    const validate = options.validate || false;

    // Load YANG/SID inputs (cached after first call)
    await this.loadInputs(verbose);

    // Step 1: Parse YAML
    const jsonData = yaml.load(yamlString);

    // Step 2: Detect format and transform accordingly
    let transformed;
    let transformStats;
    const isInstanceId = isInstanceIdentifierFormat(jsonData);

    if (isInstanceId) {
      // Instance-identifier format (RFC 8072 style) - direct parsing
      if (verbose) {
        console.log('\nDetected instance-identifier format (RFC 8072 style)');
        console.log('Direct transformation: Instance-ID -> Delta-SID Object...');
      }

      transformed = transformInstanceIdentifier(jsonData, this.typeTable, this.sidInfo, {
        useMap: true,
        sortMode,
        verbose
      });

      transformStats = getInstanceIdTransformStats(jsonData, transformed);

      if (verbose) {
        console.log(`  Input paths: ${transformStats.inputPaths}`);
        console.log(`  Output entries: ${transformStats.outputEntries}`);
      }
    } else {
      // RFC 7951 format - existing pipeline
      if (verbose) {
        console.log('\nDetected RFC 7951 format');
        console.log('Transformation: JSON -> Delta-SID Object...');
      }

      transformed = transform(jsonData, this.typeTable, this.sidInfo, {
        useDeltaSid: true,
        rootPath: '',
        useMap: true,
        sortMode
      });

      transformStats = getTransformStats(jsonData, transformed);

      if (verbose) {
        console.log(`  Original keys: ${transformStats.originalKeys}`);
        console.log(`  Transformed keys: ${transformStats.transformedKeys}`);
        console.log(`  Size ratio: ${(transformStats.transformedKeys / transformStats.originalKeys * 100).toFixed(1)}%`);
      }
    }

    // Step 3: Encode to CBOR
    if (verbose) {
      console.log('\nEncoding: JavaScript Object -> CBOR Binary...');
    }

    const cbor = encodeToCbor(transformed, {
      useCompatible: compatible,
      sortMode
    });

    const encodingStats = getEncodingStats(transformed, cbor);

    // Step 4: Calculate statistics
    const yamlSize = Buffer.byteLength(yamlString, 'utf8');
    const jsonSize = Buffer.byteLength(JSON.stringify(jsonData), 'utf8');
    const cborSize = cbor.length;

    const stats = {
      yamlSize,
      jsonSize,
      cborSize,
      compressionRatio: ((yamlSize - cborSize) / yamlSize * 100).toFixed(1),
      savedBytes: yamlSize - cborSize,
      transformStats,
      encodingStats,
      deltaSidStats: getDeltaSidStats()
    };

    // Step 5: Save to file (if outputFile specified)
    if (outputFile) {
      fs.writeFileSync(outputFile, cbor);
      if (verbose) {
        console.log(`\nCBOR written to: ${outputFile}`);
      }
    }

    // Generate diagnostic output
    if (diagnostic && outputFile) {
      const diagPath = outputFile.replace(/\.cbor$/, '.diag.txt');
      const diagContent = getCborDiagnostic(cbor);
      fs.writeFileSync(diagPath, diagContent);
      if (verbose) {
        console.log(`Diagnostic written to: ${diagPath}`);
      }
    }

    // Validate round-trip
    if (validate) {
      if (verbose) {
        console.log('\nValidating round-trip...');
      }

      const decoded = decodeFromCbor(cbor);
      const isValid = verifyRoundTrip(transformed, decoded);

      if (isValid) {
        if (verbose) {
          console.log('Round-trip validation passed');
        }
      } else {
        if (verbose) {
          console.log('Round-trip validation failed');
        }
      }

      stats.roundTripValid = isValid;
    }

    // Print statistics
    if (verbose) {
      console.log('\nConversion Statistics:');
      console.log(`  Original YAML: ${stats.yamlSize} bytes`);
      console.log(`  JSON size: ${stats.jsonSize} bytes`);
      console.log(`  CBOR size: ${stats.cborSize} bytes`);
      console.log(`  Compression: ${stats.compressionRatio}% saved`);
      console.log(`  Saved: ${stats.savedBytes} bytes`);

      if (stats.deltaSidStats) {
        console.log('\nDelta-SID Statistics:');
        console.log(`  Average delta: ${stats.deltaSidStats.avgDelta.toFixed(2)}`);
        console.log(`  Max delta: ${stats.deltaSidStats.maxDelta}`);
        console.log(`  Min delta: ${stats.deltaSidStats.minDelta}`);
        console.log(`  Compression ratio: ${stats.deltaSidStats.compressionRatio.toFixed(1)}%`);
      }
    }

    return {
      cbor,
      jsonData,
      transformed,
      stats
    };
  }
}

export { Tsc2CborConverter };
