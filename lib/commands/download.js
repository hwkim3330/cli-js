/**
 * Download command - Download YANG catalog from device or remote server
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSC2CBOR_LIB = pathToFileURL(path.resolve(__dirname, '../../tsc2cbor/lib')).href;

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
 * Download YANG catalog
 * @param {object} options - Command options
 * @param {string} options.device - Device path
 * @param {string} options.checksum - Optional checksum (skip device query)
 * @param {boolean} options.verbose - Verbose output
 */
export async function downloadCommand(options) {
  const { SerialManager } = await import(`${TSC2CBOR_LIB}/serial/serial.js`);
  const { YangCatalogManager } = await import(`${TSC2CBOR_LIB}/yang-catalog/yang-catalog.js`);

  const yangCatalog = new YangCatalogManager();
  let checksum = options.checksum;

  // If no checksum provided, query from device
  if (!checksum) {
    const serialManager = new SerialManager();

    try {
      console.log(`Connecting to ${options.device}...`);
      await serialManager.connect(options.device);
      console.log('Connected.');

      console.log('Waiting for board ANNOUNCE...');
      await waitForBoardReady(serialManager, 5000);
      console.log('Board ready.\n');

      checksum = await yangCatalog.queryChecksumFromDevice(serialManager);

    } catch (error) {
      throw error;
    } finally {
      if (serialManager.getConnectionStatus()) {
        await serialManager.disconnect();
      }
    }
  }

  // Check if already cached
  let catalogInfo = yangCatalog.getCatalogInfo(checksum);
  if (catalogInfo) {
    console.log(`\nYANG catalog already available!`);
    console.log(`  Checksum: ${checksum}`);
    console.log(`  Path: ${catalogInfo.path}`);
    console.log(`  YANG files: ${catalogInfo.count.yang}`);
    console.log(`  SID files: ${catalogInfo.count.sid}`);
    return;
  }

  // Download and extract catalog
  console.log(`\nDownloading catalog: ${checksum}`);
  const tarPath = await yangCatalog.downloadCatalog(checksum);
  const catalogDir = await yangCatalog.extractCatalog(tarPath);

  catalogInfo = yangCatalog.getCatalogInfo(checksum);
  console.log(`\nYANG catalog ready!`);
  console.log(`  Checksum: ${checksum}`);
  console.log(`  Path: ${catalogDir}`);
  console.log(`  YANG files: ${catalogInfo.count.yang}`);
  console.log(`  SID files: ${catalogInfo.count.sid}`);
}
