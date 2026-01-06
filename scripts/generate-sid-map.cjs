#!/usr/bin/env node
/**
 * Generate SID to YANG path mapping for browser use
 */

const fs = require('fs');
const path = require('path');

const YANG_CACHE_DIR = path.join(__dirname, '../tsc2cbor/.yang-cache');

function generateSidMap() {
  // Find the cache directory
  const dirs = fs.readdirSync(YANG_CACHE_DIR).filter(d =>
    fs.statSync(path.join(YANG_CACHE_DIR, d)).isDirectory()
  );

  if (dirs.length === 0) {
    console.error('No YANG cache found. Run: node bin/keti-tsn.js download');
    process.exit(1);
  }

  const cacheDir = path.join(YANG_CACHE_DIR, dirs[0]);
  console.log('Using cache:', cacheDir);

  const sidMap = {};

  // Read all .sid files
  const sidFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.sid'));

  for (const file of sidFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    const moduleName = content['module-name'];

    for (const item of content.items || []) {
      if (item.namespace === 'data' && item.sid && item.identifier) {
        // Convert YANG path to readable format
        let yangPath = item.identifier;

        // Store both absolute SID and path
        sidMap[item.sid] = {
          path: yangPath,
          module: moduleName
        };
      }
    }
  }

  // Generate output
  const output = {
    version: '1.0',
    generated: new Date().toISOString(),
    checksum: dirs[0],
    count: Object.keys(sidMap).length,
    map: sidMap
  };

  // Write to docs folder for browser use
  const outputPath = path.join(__dirname, '../docs/js/sid-map.js');
  const jsContent = `// Auto-generated SID mapping\nconst SID_MAP = ${JSON.stringify(output, null, 2)};\n`;
  fs.writeFileSync(outputPath, jsContent);

  console.log(`Generated ${Object.keys(sidMap).length} SID mappings`);
  console.log(`Output: ${outputPath}`);
}

generateSidMap();
