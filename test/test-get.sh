#!/bin/bash
#
# 전체 설정 조회 테스트 (GET)
#
# Usage:
#   ./test-get.sh /dev/ttyACM0
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"

if [ -z "$1" ]; then
    echo "Usage: $0 <device>"
    echo "Example: $0 /dev/ttyACM0"
    exit 1
fi

DEVICE="$1"
OUTPUT="$SCRIPT_DIR/configs/device-backup.yaml"

echo "========================================"
echo "Get Command Test"
echo "Device: $DEVICE"
echo "========================================"
echo

echo "[get] 전체 설정 조회"
echo "----------------------------------------"
$CLI $DEVICE get -o "$OUTPUT"
RESULT=$?

if [ $RESULT -eq 0 ] && [ -f "$OUTPUT" ]; then
    echo
    echo "✓ 설정 백업 완료: $OUTPUT"
    echo "----------------------------------------"
    head -30 "$OUTPUT"
    echo "..."
fi

echo
echo "========================================"
exit $RESULT
