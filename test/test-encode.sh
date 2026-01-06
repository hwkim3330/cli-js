#!/bin/bash
#
# YAML → CBOR 인코딩 테스트
#
# Usage:
#   ./test-encode.sh
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"
CONFIG_DIR="$SCRIPT_DIR/configs"

echo "========================================"
echo "Encode Command Test (YAML → CBOR)"
echo "========================================"
echo

INPUT="$CONFIG_DIR/tas-gate-enable.yaml"
OUTPUT="$CONFIG_DIR/tas-gate-enable.cbor"

echo "Input:  $INPUT"
echo "Output: $OUTPUT"
echo "----------------------------------------"
cat "$INPUT"
echo "----------------------------------------"
echo

$CLI encode "$INPUT" -o "$OUTPUT"
RESULT=$?

if [ $RESULT -eq 0 ] && [ -f "$OUTPUT" ]; then
    echo
    echo "✓ CBOR 파일 생성됨: $(ls -lh "$OUTPUT" | awk '{print $5}')"
    echo
    echo "CBOR 내용 (hex):"
    xxd "$OUTPUT" | head -10
fi

echo
echo "========================================"
exit $RESULT
