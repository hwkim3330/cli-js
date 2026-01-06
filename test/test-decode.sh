#!/bin/bash
#
# CBOR → YAML 디코딩 테스트
#
# Usage:
#   ./test-decode.sh
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"
CONFIG_DIR="$SCRIPT_DIR/configs"

echo "========================================"
echo "Decode Command Test (CBOR → YAML)"
echo "========================================"
echo

INPUT="$CONFIG_DIR/tas-gate-enable.cbor"
OUTPUT="$CONFIG_DIR/tas-gate-enable.decoded.yaml"

if [ ! -f "$INPUT" ]; then
    echo "Error: $INPUT 파일이 없습니다."
    echo "먼저 test-encode.sh를 실행하세요."
    exit 1
fi

echo "Input:  $INPUT"
echo "Output: $OUTPUT"
echo "----------------------------------------"

$CLI decode "$INPUT" -o "$OUTPUT"
RESULT=$?

if [ $RESULT -eq 0 ] && [ -f "$OUTPUT" ]; then
    echo
    echo "✓ YAML 파일 생성됨"
    echo "----------------------------------------"
    cat "$OUTPUT"
fi

echo
echo "========================================"
exit $RESULT
