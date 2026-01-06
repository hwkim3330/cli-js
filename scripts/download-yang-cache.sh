#!/bin/bash
#
# Download YANG Catalog for keti-tsn-cli
#
# Usage: ./scripts/download-yang-cache.sh [checksum]
#
# If no checksum provided, uses default VelocityDRIVE-SP checksum

set -e

# Default checksum (VelocityDRIVE-SP)
DEFAULT_CHECKSUM="5151bae07677b1501f9cf52637f2a38f"
CHECKSUM="${1:-$DEFAULT_CHECKSUM}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_DIR="$PROJECT_ROOT/tsc2cbor/.yang-cache"

# Remote catalog URLs
REMOTE_URLS=(
  "http://mscc-ent-open-source.s3-website-eu-west-1.amazonaws.com/public_root/velocitydrivesp/yang-by-sha"
  "https://artifacts.microchip.com/artifactory/UNGE-generic-local/lmstax/yang-by-sha"
)

echo "=== YANG Catalog Downloader ==="
echo ""
echo "Checksum: $CHECKSUM"
echo "Cache dir: $CACHE_DIR"
echo ""

# Create cache directory
mkdir -p "$CACHE_DIR"

# Check if already extracted
EXTRACT_DIR="$CACHE_DIR/$CHECKSUM"
if [ -d "$EXTRACT_DIR" ]; then
  YANG_COUNT=$(find "$EXTRACT_DIR" -name "*.yang" | wc -l)
  SID_COUNT=$(find "$EXTRACT_DIR" -name "*.sid" | wc -l)
  echo "Catalog already exists!"
  echo "  YANG files: $YANG_COUNT"
  echo "  SID files: $SID_COUNT"
  echo "  Path: $EXTRACT_DIR"
  exit 0
fi

# Download tar.gz
TARFILE="$CACHE_DIR/$CHECKSUM.tar.gz"

if [ -f "$TARFILE" ]; then
  echo "Using cached tarball: $TARFILE"
else
  echo "Downloading catalog..."

  DOWNLOADED=false
  for URL_BASE in "${REMOTE_URLS[@]}"; do
    URL="$URL_BASE/$CHECKSUM.tar.gz"
    echo "  Trying: $URL_BASE"

    if curl -fsSL -o "$TARFILE" "$URL" 2>/dev/null; then
      echo "  Downloaded successfully!"
      DOWNLOADED=true
      break
    else
      echo "  Failed, trying next..."
    fi
  done

  if [ "$DOWNLOADED" = false ]; then
    echo ""
    echo "ERROR: Failed to download from all sources"
    exit 1
  fi
fi

# Extract
echo ""
echo "Extracting..."
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARFILE" -C "$EXTRACT_DIR"

# Count files
YANG_COUNT=$(find "$EXTRACT_DIR" -name "*.yang" | wc -l)
SID_COUNT=$(find "$EXTRACT_DIR" -name "*.sid" | wc -l)

echo ""
echo "YANG Catalog ready!"
echo "  Checksum: $CHECKSUM"
echo "  YANG files: $YANG_COUNT"
echo "  SID files: $SID_COUNT"
echo "  Path: $EXTRACT_DIR"
