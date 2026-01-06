#!/usr/bin/env node

/**
 * keti-tsn CLI
 *
 * TSN Switch (LAN9662) Configuration CLI Tool
 *
 * Usage:
 *   keti-tsn <command> [options]
 *
 * Examples:
 *   keti-tsn checksum
 *   keti-tsn download
 *   keti-tsn list
 *   keti-tsn encode config.yaml -o config.cbor
 *   keti-tsn decode response.cbor -o response.yaml
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load package.json for version
const packageJson = JSON.parse(
  fs.readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

// Default device path
const DEFAULT_DEVICE = '/dev/ttyACM0';

/**
 * Show help message
 */
function showHelp() {
  console.log(`
keti-tsn v${packageJson.version}

TSN Switch (LAN9662) Configuration CLI Tool

Usage:
  keti-tsn <command> [options]

Commands:
  checksum              Query YANG catalog checksum from device
  download              Download YANG catalog from device
  list                  List cached YANG catalogs (offline)
  encode <file>         Encode YAML to CBOR (offline)
  decode <file>         Decode CBOR to YAML (offline)
  get                   Get full configuration from device
  fetch <file>          Fetch configuration values from device
  patch <file>          Apply configuration patch to device

Options:
  -d, --device <path>   Device path (default: ${DEFAULT_DEVICE})
  -o, --output <file>   Output file
  -c, --cache <dir>     YANG cache directory
  --format <type>       Output format: rfc7951 | instance-id
  -v, --verbose         Verbose output
  -V, --version         Show version
  -h, --help            Show help

Examples:
  keti-tsn checksum                      # Query checksum (default device)
  keti-tsn checksum -d /dev/ttyUSB0      # Query checksum (specific device)
  keti-tsn download                      # Download YANG catalog
  keti-tsn list                          # List cached catalogs
  keti-tsn encode config.yaml -o out.cbor
  keti-tsn decode response.cbor -o out.yaml
  keti-tsn get -o backup.yaml
`);
}

/**
 * Parse command line options
 */
function parseArgs(args) {
  const options = {
    command: null,
    file: null,
    device: DEFAULT_DEVICE,
    output: null,
    cache: null,
    format: 'rfc7951',
    verbose: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-V' || arg === '--version') {
      console.log(packageJson.version);
      process.exit(0);
    } else if (arg === '-d' || arg === '--device') {
      options.device = args[++i];
    } else if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else if (arg === '-c' || arg === '--cache') {
      options.cache = args[++i];
    } else if (arg === '--format') {
      options.format = args[++i];
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (!arg.startsWith('-')) {
      // Positional arguments
      if (!options.command) {
        options.command = arg;
      } else if (!options.file) {
        options.file = arg;
      }
    }
    i++;
  }

  return options;
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Show help if no arguments
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  // Show help if no command
  if (!options.command) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (options.command) {
      case 'checksum': {
        const { checksumCommand } = await import('../lib/commands/checksum.js');
        await checksumCommand(options);
        break;
      }

      case 'download': {
        const { downloadCommand } = await import('../lib/commands/download.js');
        await downloadCommand(options);
        break;
      }

      case 'list': {
        const { listCommand } = await import('../lib/commands/list.js');
        await listCommand(options);
        break;
      }

      case 'encode': {
        const { encodeCommand } = await import('../lib/commands/encode.js');
        if (!options.file) {
          console.error('Error: Input file required');
          console.log('Usage: keti-tsn encode <file> [-o output]');
          process.exit(1);
        }
        await encodeCommand(options.file, options);
        break;
      }

      case 'decode': {
        const { decodeCommand } = await import('../lib/commands/decode.js');
        if (!options.file) {
          console.error('Error: Input file required');
          console.log('Usage: keti-tsn decode <file> [-o output]');
          process.exit(1);
        }
        await decodeCommand(options.file, options);
        break;
      }

      case 'get': {
        const { getCommand } = await import('../lib/commands/get.js');
        await getCommand(options);
        break;
      }

      case 'fetch': {
        const { fetchCommand } = await import('../lib/commands/fetch.js');
        if (!options.file) {
          console.error('Error: Input file required');
          console.log('Usage: keti-tsn fetch <file> [-o output]');
          process.exit(1);
        }
        await fetchCommand(options.file, options);
        break;
      }

      case 'patch': {
        const { patchCommand } = await import('../lib/commands/patch.js');
        if (!options.file) {
          console.error('Error: Input file required');
          console.log('Usage: keti-tsn patch <file>');
          process.exit(1);
        }
        await patchCommand(options.file, options);
        break;
      }

      default:
        console.error(`Unknown command: ${options.command}`);
        console.log('Run "keti-tsn --help" for usage information.');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
