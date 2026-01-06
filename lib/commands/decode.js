/**
 * Decode CBOR to YAML command (offline)
 *
 * Converts CBOR binary to YAML configuration using RFC 9254 Delta-SID decoding.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC2CBOR_LIB = path.resolve(__dirname, '../../tsc2cbor');

/**
 * Find YANG cache directory
 * @param {string|null} cacheOption - User-specified cache path
 * @returns {Promise<string>} Path to YANG cache directory
 */
async function findYangCache(cacheOption) {
  if (cacheOption) {
    if (!fs.existsSync(cacheOption)) {
      throw new Error(`Cache directory not found: ${cacheOption}`);
    }
    return cacheOption;
  }

  const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/lib/yang-catalog/yang-catalog.js`);
  const yangCatalog = new YangCatalogManager();
  const catalogs = yangCatalog.listCachedCatalogs();

  if (catalogs.length === 0) {
    throw new Error(
      'No YANG catalog found. Please run "keti-tsn download" first, or specify -c <cache_dir>'
    );
  }

  return catalogs[0].path;
}

/**
 * Decode CBOR to YAML
 * @param {string} input - Input CBOR file path
 * @param {object} options - Command options
 */
export async function decodeCommand(input, options) {
  const verbose = options.verbose || false;
  const format = options.format || 'rfc7951';

  if (!fs.existsSync(input)) {
    throw new Error(`Input file not found: ${input}`);
  }

  const outputFile = options.output || input.replace(/\.cbor$/i, '.yaml');

  if (verbose) {
    console.log(`Input:  ${input}`);
    console.log(`Output: ${outputFile}`);
    console.log(`Format: ${format}`);
  }

  const yangCacheDir = await findYangCache(options.cache);
  if (verbose) {
    console.log(`Cache:  ${yangCacheDir}`);
  }

  const { Cbor2TscConverter } = await import(`${TSC2CBOR_LIB}/cbor2tsc.js`);
  const converter = new Cbor2TscConverter(yangCacheDir);

  const result = await converter.convertFile(input, {
    outputFile,
    verbose,
    outputFormat: format
  });

  console.log(`\nDecoded: ${input} -> ${outputFile}`);
  console.log(`   ${result.stats.cborSize} bytes -> ${result.stats.yamlSize} bytes`);
}
