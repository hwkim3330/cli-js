/**
 * Get full configuration command
 *
 * Retrieves full device configuration via CoAP GET request.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC2CBOR_LIB = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor/lib')).href;
const TSC2CBOR = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor')).href;

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

  const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);
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
 * Get full configuration from device
 * @param {object} options - Command options
 */
export async function getCommand(options) {
  const verbose = options.verbose || false;
  const format = options.format || 'rfc7951';

  const { SerialManager } = await import(`${TSC2CBOR_LIB}/serial/serial.js`);
  const { Cbor2TscConverter } = await import(`${TSC2CBOR}/cbor2tsc.js`);

  const serialManager = new SerialManager();

  try {
    // Connect to device
    console.log(`Connecting to ${options.device}...`);
    await serialManager.connect(options.device);
    console.log('Connected.\n');

    // Wait for board to be ready
    await waitForBoardReady(serialManager, 5000);

    // Send GET request
    console.log('Fetching full configuration...');
    const response = await serialManager.sendGetRequest();

    if (!response.isSuccess()) {
      throw new Error(`GET request failed: CoAP code ${response.code}`);
    }

    // Get raw CBOR payload
    const cborPayload = response.payload;
    console.log(`Received ${cborPayload.length} bytes`);

    // Find YANG cache and decode
    const yangCacheDir = await findYangCache(options.cache);
    const converter = new Cbor2TscConverter(yangCacheDir);

    const result = await converter.convertBuffer(cborPayload, {
      verbose,
      outputFormat: format
    });

    // Output result
    if (options.output) {
      fs.writeFileSync(options.output, result.yaml, 'utf8');
      console.log(`\nConfiguration saved to: ${options.output}`);
    } else {
      console.log('\n--- Configuration ---\n');
      console.log(result.yaml);
    }

  } finally {
    if (serialManager.getConnectionStatus()) {
      await serialManager.disconnect();
    }
  }
}

/**
 * Wait for board to be ready (ANNOUNCE received)
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
