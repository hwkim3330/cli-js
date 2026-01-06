# keti-tsn-cli

Microchip TSN 스위치 설정을 위한 CLI 도구

## 개요

`keti-tsn-cli`는 Microchip TSN 스위치와 통신하기 위한 독립적인 CLI 도구입니다.
`mvdct`(Microchip VelocityDRIVE CT CLI)의 핵심 기능을 JavaScript로 재구현하여, 오픈소스 기반의 유연한 TSN 설정 환경을 제공합니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| `list` | 캐시된 YANG 카탈로그 목록 |
| `checksum` | 장비 YANG 카탈로그 체크섬 조회 |
| `download` | YANG 카탈로그 다운로드 |
| `encode` | YAML → CBOR 변환 (오프라인) |
| `decode` | CBOR → YAML 변환 (오프라인) |
| `fetch` | 특정 설정값 조회 (iFETCH) |
| `patch` | 설정값 변경 (iPATCH) |
| `get` | 전체 설정 조회 (Block-wise GET) |

## 설치

```bash
npm install
```

## 시작하기

장비와 통신하기 전에 YANG 카탈로그를 다운로드해야 합니다. 최초 1회만 수행하면 됩니다.

```bash
# 1. 장비의 YANG 카탈로그 체크섬 확인
./keti-tsn checksum

# 2. YANG 카탈로그 다운로드 (체크섬 기반으로 자동 다운로드)
./keti-tsn download

# 3. 다운로드된 카탈로그 확인
./keti-tsn list
```

이후 `fetch`, `patch`, `get` 등의 명령을 사용할 수 있습니다.

## 사용법

```bash
# 도움말
./keti-tsn --help
./keti-tsn -h

# 버전 확인
./keti-tsn --version
./keti-tsn -V
```

### 오프라인 명령 (장비 불필요)

```bash
# 캐시된 YANG 카탈로그 목록
./keti-tsn list

# YAML → CBOR 변환
./keti-tsn encode config.yaml -o config.cbor

# CBOR → YAML 변환
./keti-tsn decode response.cbor -o response.yaml
```

### 장비 명령 (디바이스 필요)

```bash
# YANG 체크섬 조회 (기본 장치: /dev/ttyACM0)
./keti-tsn checksum

# YANG 체크섬 조회 (장치 지정)
./keti-tsn checksum -d /dev/ttyUSB0

# YANG 카탈로그 다운로드
./keti-tsn download

# 전체 설정 조회
./keti-tsn get -o backup.yaml

# 설정값 조회 (iFETCH)
./keti-tsn fetch query.yaml -o result.yaml

# 설정값 변경 (iPATCH)
./keti-tsn patch config.patch.yaml
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `-d, --device <path>` | 장치 경로 (기본값: `/dev/ttyACM0`) |
| `-o, --output <file>` | 출력 파일 |
| `-c, --cache <dir>` | YANG 캐시 디렉토리 |
| `--format <type>` | 출력 형식: `rfc7951` \| `instance-id` |
| `-v, --verbose` | 상세 출력 |
| `-V, --version` | 버전 표시 |
| `-h, --help` | 도움말 표시 |

## 프로젝트 구조

```
keti-tsn-cli/
├── keti-tsn                # CLI wrapper 스크립트
├── bin/
│   └── keti-tsn.js         # CLI 진입점
├── lib/
│   └── commands/           # CLI 명령어 구현
│       ├── checksum.js     # YANG 체크섬 조회
│       ├── download.js     # YANG 카탈로그 다운로드
│       ├── list.js         # 캐시 목록 조회
│       ├── encode.js       # YAML → CBOR 변환
│       ├── decode.js       # CBOR → YAML 변환
│       ├── fetch.js        # 설정값 조회
│       ├── patch.js        # 설정값 변경
│       └── get.js          # 전체 설정 조회
├── tsc2cbor/               # CBOR 변환 라이브러리
│   ├── lib/
│   │   ├── common/         # 공통 모듈
│   │   │   ├── input-loader.js    # YANG/SID 로딩 (공통)
│   │   │   ├── sid-resolver.js    # SID 리졸버
│   │   │   ├── yang-type-extractor.js  # YANG 타입 추출
│   │   │   └── cbor-encoder.js    # CBOR 인코더
│   │   ├── encoder/        # YAML → CBOR 변환
│   │   ├── decoder/        # CBOR → YAML 변환
│   │   ├── serial/         # 시리얼 통신 (MUP1 프로토콜)
│   │   ├── coap/           # CoAP 프로토콜
│   │   └── yang-catalog/   # YANG 카탈로그 관리
│   ├── tsc2cbor.js         # YAML → CBOR 변환기
│   └── cbor2tsc.js         # CBOR → YAML 변환기
├── scripts/
│   └── download-yang-cache.sh  # YANG 캐시 다운로드 스크립트
├── test/                   # 테스트 스크립트
│   └── configs/            # 테스트용 설정 파일
├── package.json
└── README.md
```

## YANG 캐시 다운로드

장비 없이 YANG 카탈로그를 다운로드하려면:

```bash
# 기본 체크섬으로 다운로드 (VelocityDRIVE-SP)
./scripts/download-yang-cache.sh

# 특정 체크섬 지정
./scripts/download-yang-cache.sh <checksum>
```

## 변경 이력

### 2024-12-29
- `fetch` 명령 구현 (iFETCH with instance-identifier format)
- `patch` 명령 구현 (iPATCH with Delta-SID CBOR)
- iPATCH 이중 인코딩 버그 수정
- iFETCH: 전체 경로에서 키 수집하도록 수정
- 모든 명령어 구현 완료 및 테스트

### 2024-12-23
- tsc2cbor 리팩토링: `loadInputs` 중복 코드 제거, `input-loader.js` 공통 모듈화
- CLI 명령어 구조 변경: `yang id` → `checksum`, `yang download` → `download`, `yang list` → `list`
- `-d` 옵션으로 디바이스 지정 (기본값: `/dev/ttyACM0`)
- `keti-tsn` wrapper 스크립트 생성 (mvdct 스타일)
- YANG 캐시 다운로드 스크립트 추가
- `encode`/`decode` 명령 구현
- `get` 명령 구현 (Block-wise GET)

### 2024-12-19
- 프로젝트 구조 생성
- tsc2cbor 라이브러리 통합
- 테스트 스크립트 구성

## 라이선스

TBD
