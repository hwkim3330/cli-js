#!/bin/bash
#
# YANG 카탈로그 테스트
#
# Usage:
#   ./test-yang.sh                    # yang list (오프라인)
#   ./test-yang.sh /dev/ttyACM0       # yang id/download (장비)
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"

echo "========================================"
echo "YANG Command Test"
echo "========================================"

if [ -z "$1" ]; then
    # 오프라인 테스트
    echo
    echo "[yang list] 캐시된 YANG 카탈로그 목록"
    echo "----------------------------------------"
    $CLI yang list
else
    # 장비 테스트
    DEVICE="$1"
    echo "Device: $DEVICE"
    echo

    echo "[yang id] YANG 카탈로그 체크섬 조회"
    echo "----------------------------------------"
    $CLI $DEVICE yang id
    echo

    # yang download는 주석 처리 (필요시 활성화)
    # echo "[yang download] YANG 카탈로그 다운로드"
    # echo "----------------------------------------"
    # $CLI $DEVICE yang download
fi

echo
echo "========================================"
