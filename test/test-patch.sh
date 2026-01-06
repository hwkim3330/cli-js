#!/bin/bash
#
# 설정값 변경 테스트 (iPATCH)
#
# Usage:
#   ./test-patch.sh /dev/ttyACM0
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
INPUT="$CONFIG_DIR/tas-gate-enable.patch.yaml"

echo "========================================"
echo "Patch Command Test"
echo "Device: $DEVICE"
echo "========================================"
echo

echo "Input: $INPUT"
echo "----------------------------------------"
cat "$INPUT"
echo "----------------------------------------"
echo

echo "[patch] 설정값 변경"
$CLI $DEVICE patch "$INPUT"
RESULT=$?

if [ $RESULT -eq 0 ]; then
    echo
    echo "✓ 설정 변경 완료"
fi

echo
echo "========================================"
exit $RESULT
