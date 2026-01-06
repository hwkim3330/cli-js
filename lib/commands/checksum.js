/**
 * Checksum command - Query YANG catalog checksum from device
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC2CBOR_LIB = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor/lib')).href;

/**
 * Wait for board to be ready (ANNOUNCE received)
 * @param {Object} serialManager - SerialManager instance
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
function waitForBoardReady(serialManager, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (serialManager.boardReady) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for board ANNOUNCE. Board may not be ready or connected properly.'));
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
 * Query YANG catalog checksum from device
 * @param {object} options - Command options
 * @param {string} options.device - Device path
 * @param {boolean} options.verbose - Verbose output
 */
export async function checksumCommand(options) {
  const { SerialManager } = await import(`${TSC2CBOR_LIB}/serial/serial.js`);
  const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);

  const serialManager = new SerialManager();
  const yangCatalog = new YangCatalogManager();

  try {
    console.log(`Connecting to ${options.device}...`);
    await serialManager.connect(options.device);
    console.log('Connected.');

    // Wait for board to be ready (ANNOUNCE frame)
    console.log('Waiting for board ANNOUNCE...');
    await waitForBoardReady(serialManager, 10000);
    console.log('Board ready.\n');

    const checksum = await yangCatalog.queryChecksumFromDevice(serialManager);
    console.log(`\nYANG Catalog Checksum: ${checksum}`);

    // Check if already cached
    const catalogInfo = yangCatalog.getCatalogInfo(checksum);
    if (catalogInfo) {
      console.log(`Status: Cached`);
      console.log(`  Path: ${catalogInfo.path}`);
      console.log(`  YANG files: ${catalogInfo.count.yang}`);
      console.log(`  SID files: ${catalogInfo.count.sid}`);
    } else {
      console.log('Status: Not cached');
      console.log('Run "keti-tsn download" to download the catalog.');
    }

  } catch (error) {
    throw error;
  } finally {
    if (serialManager.getConnectionStatus()) {
      await serialManager.disconnect();
    }
  }
}
