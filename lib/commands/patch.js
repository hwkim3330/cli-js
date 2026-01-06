/**
 * Patch configuration command (iPATCH)
 *
 * Modifies configuration values on device using CoAP iPATCH.
 * Supports both instance-identifier and RFC 7951 formats.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

// Static imports for better performance (no dynamic import overhead)
import { YangCatalogManager } from '../../tsc2cbor/lib/yang-catalog/yang-catalog.js';
import { Tsc2CborConverter } from '../../tsc2cbor/tsc2cbor.js';
import { SerialManager } from '../../tsc2cbor/lib/serial/serial.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find YANG cache directory
 */
async function findYangCache(cacheOption) {
  if (cacheOption) {
    if (!fs.existsSync(cacheOption)) {
      throw new Error(`Cache directory not found: ${cacheOption}`);
    }
    return cacheOption;
  }

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
 * Wait for board to be ready
 */
function waitForBoardReady(serialManager, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (serialManager.boardReady) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for board ANNOUNCE'));
    }, timeout);

    const checkReady = () => {
      if (serialManager.boardReady) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(checkReady, 100);
      }
    };

    checkReady();
  });
}

/**
 * Patch configuration values on device
 * @param {string} file - Input YAML file (instance-identifier or RFC 7951 format)
 * @param {object} options - Command options
 */
export async function patchCommand(file, options) {
  const verbose = options.verbose || false;

  if (!fs.existsSync(file)) {
    throw new Error(`Input file not found: ${file}`);
  }

  // Find YANG cache
  const yangCacheDir = await findYangCache(options.cache);

  // Convert YAML to CBOR using tsc2cbor
  const encoder = new Tsc2CborConverter(yangCacheDir);

  if (verbose) {
    console.log('Converting patch data to CBOR...');
  }

  const encodeResult = await encoder.convertFile(file, { verbose });

  // Use CBOR-encoded buffer for iPATCH (already encoded)
  const patchData = encodeResult.cbor;

  if (verbose) {
    console.log(`Patch data size: ${patchData.length} bytes`);
  }

  // Connect and send iPATCH
  const serialManager = new SerialManager({ verbose });

  try {
    if (verbose) console.log(`Connecting to ${options.device}...`);
    await serialManager.connect(options.device);
    if (verbose) console.log('Connected.\n');

    await waitForBoardReady(serialManager, 5000);

    if (verbose) console.log('Sending iPATCH request...');
    const response = await serialManager.sendiPatchRequest(patchData);

    if (!response.isSuccess()) {
      throw new Error(`iPATCH failed: CoAP code ${response.code}`);
    }

    if (verbose) console.log('iPATCH successful!');

    // Check if there's any response payload (error details)
    if (response.payload && response.payload.length > 0) {
      if (verbose) {
        console.log(`Response payload: ${response.payload.length} bytes`);
      }
    }

  } finally {
    if (serialManager.getConnectionStatus()) {
      await serialManager.disconnect();
    }
  }
}
