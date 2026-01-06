#!/bin/bash
#
# 설정값 조회 테스트 (iFETCH)
#
# Usage:
#   ./test-fetch.sh /dev/ttyACM0
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"
CONFIG_DIR="$SCRIPT_DIR/configs"

if [ -z "$1" ]; then
    echo "Usage: $0 <device>"
    echo "Example: $0 /dev/ttyACM0"
    exit 1
fi

DEVICE="$1"
INPUT="$CONFIG_DIR/tas-gate-enable.yaml"
OUTPUT="$CONFIG_DIR/tas-gate-enable.fetched.yaml"

echo "========================================"
echo "Fetch Command Test"
echo "Device: $DEVICE"
echo "========================================"
echo

echo "Input:  $INPUT"
echo "Output: $OUTPUT"
echo "----------------------------------------"
cat "$INPUT"
echo "----------------------------------------"
echo

echo "[fetch] 설정값 조회"
$CLI $DEVICE fetch "$INPUT" -o "$OUTPUT"
RESULT=$?

if [ $RESULT -eq 0 ] && [ -f "$OUTPUT" ]; then
    echo
    echo "✓ 조회 결과:"
    echo "----------------------------------------"
    cat "$OUTPUT"
fi

echo
echo "========================================"
exit $RESULT
