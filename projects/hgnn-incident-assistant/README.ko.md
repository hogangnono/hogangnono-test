# hgnn-incident-assistant

[English](README.md) | 한국어

## 무엇인가

호갱노노 인시던트 채널을 감시하고, AlertNow 메시지를 레포지토리 문맥과 함께
분석해 스레드에 구조화된 답변을 남기는 로컬 Slack polling 봇입니다.

## 왜 존재하나

이 프로젝트는 Slack, 로컬 레포, 선택적으로 AWS/Loki 문맥까지 모아
초기 장애 대응 시간을 줄일 수 있는지 검증하기 위한 실험입니다.

## 스택

- Node.js
- `@slack/web-api`
- 분석 생성을 위한 로컬 `codex` 또는 `claude` CLI

## 실행 방법

1. 프로젝트 디렉터리로 이동합니다.
2. 의존성을 설치합니다.
3. `.env.example`을 `.env`로 복사합니다.
4. 필수 환경변수를 채웁니다.
5. `scan` 또는 `loop` 모드로 실행합니다.

```bash
cd projects/hgnn-incident-assistant
npm install
cp .env.example .env
npm start
```

자주 쓰는 변형:

```bash
# 한 번만 스캔하고 종료
npm run start:scan

# 계속 실행
npm run start:loop

# Slack에 쓰지 않고 로컬에서만 확인
DRY_RUN=1 npm start

# 실제 모델 호출 없이 포맷만 검증
RUN_MODE=scan DRY_RUN=1 LLM_PROVIDER=mock npm start
```

## 환경변수

먼저 `.env.example`을 복사합니다.

```bash
cp .env.example .env
```

필수:

- `SLACK_BOT_TOKEN`
- `SLACK_ALERT_CHANNEL_IDS`

권장:

- `REPO_ROOTS`
  - 로컬 코드 근거를 수집할 레포 루트 목록입니다.
  - `:` 로 구분합니다.
  - 예시:
    `/absolute/path/to/hogangnono-api:/absolute/path/to/hogangnono-bot`

선택:

- `RUN_MODE`
  - `scan` 또는 `loop`. 기본값은 `scan`
- `LLM_PROVIDER`
  - `codex`, `claude`, `mock`. 기본값은 `codex`
- `PREFER_CODEX_MCP`
  - Codex MCP가 가능하면 우선 사용하려면 `1`
- `ALERT_SOURCE_NAME`
  - 기대하는 인시던트 봇 표시 이름. 기본값은 `AlertNow`
- `SLACK_DETAIL_AS_FILE`
  - 상세 분석을 파일로 첨부하려면 `1`
- `DRY_RUN`
  - Slack에 쓰지 않고 로컬 출력만 확인하려면 `1`

선택 튜닝:

- `MAX_CONTEXT_CHARS`
- `CONTEXT_TIMEOUT_MS`
- `LLM_TIMEOUT_MS`
- `AWS_TIMEOUT_MS`
- `STARTUP_BACKFILL`
- `STARTUP_BACKFILL_LOOKBACK_HOURS`
- `STARTUP_BACKFILL_MESSAGE_LIMIT`
- `POLL_LOOKBACK_HOURS`
- `POLL_MESSAGE_LIMIT`
- `MAX_MESSAGES_PER_SCAN`
- `MAX_ANALYSES_PER_RUN`
- `LOOP_INTERVAL_SECONDS`

선택 런타임 경로:

- `STATE_FILE`
  - 기본값: `.data/state.json`
- `APP_LOG_FILE`
  - 기본값: `.data/runtime.log`

레거시 호환:

- `SLACK_ALERT_CHANNEL_ID`
  - 단일 채널 alias로는 지원하지만, 권장 설정은 `SLACK_ALERT_CHANNEL_IDS`

## 현재 상태

active

## 다음 단계

- 큰 모노레포에서 레포 근거 선택 로직 더 정교화
- AWS/Loki 문맥이 없을 때 fallback 동작 개선
- 근거가 길 때 Slack 답변 포맷 다듬기

## 분석 흐름

이 어시스턴트는 아래 순서로 동작합니다.

1. 설정된 Slack 채널에서 후보 메시지를 가져옵니다.
2. AlertNow 인시던트인지 판별합니다.
3. 루트 메시지, 관련 스레드 답글, permalink를 합칩니다.
4. 요청 경로, 메서드, 상태 코드, 에러 문구를 파싱합니다.
5. 로컬 레포와 선택적 AWS/Loki 문맥을 수집합니다.
6. `codex`, `claude`, `mock` 중 하나로 분석 초안을 생성합니다.
7. 스레드에 요약과 상세 근거를 포함한 답글을 남기거나 갱신합니다.

## 주요 기능

- AlertNow 루트 메시지와 같은 출처의 스레드 답글을 함께 분석
- 원본 메시지 permalink가 있으면 따라가서 문맥 보강
- Slack 스레드에서 수동 재분석 지원
- 사람이 이미 답했거나 봇이 처리한 스레드는 중복 작업 방지
- `scan`, `loop` 두 실행 모드 지원
- 재시작 시 미완료 pending reply 복구 가능
- 최근 누락 인시던트용 startup backfill 지원
- `DRY_RUN=1`로 Slack 쓰기 없이 로컬 검증 가능

## Slack 앱 요구사항

필수 scope:

- `channels:history`
- `chat:write`

선택 scope:

- `files:write`
  - `SLACK_DETAIL_AS_FILE=1`일 때만 필요

봇은 워크스페이스에 설치되어 있어야 하고, 대상 채널에 초대되어 있어야 합니다.

## 로컬 파일 분석

저장된 incident fixture나 임의의 텍스트 파일로 직접 돌릴 수 있습니다.

```bash
node src/cli.mjs --file test/fixtures/alertnow-news.txt
```

LLM 프롬프트만 보고 싶다면:

```bash
node src/cli.mjs --file test/fixtures/alertnow-news.txt --print-prompt
```

실제 모델 없이 실행하려면:

```bash
LLM_PROVIDER=mock node src/cli.mjs --file test/fixtures/alertnow-news.txt
```

stdin으로도 입력할 수 있습니다.

```bash
cat test/fixtures/alertnow-news.txt | node src/cli.mjs
```
