# hogangnono-test

[English](README.md) | 한국어

토이 프로젝트, 프로토타입, 일회성 실험은 먼저 이 저장소에 넣습니다.

이 저장소는 인큐베이터 역할을 합니다. 작게 시작하고 빠르게 검증한 뒤,
실험 단계를 넘어선 프로젝트만 별도 저장소로 분리합니다.

## 이 저장소를 쓰는 경우

다음과 같은 경우에 사용합니다.

- 아이디어가 아직 실험 단계일 때
- 프로젝트 수명이 짧을 가능성이 높을 때
- 별도 저장소를 만들 비용이 아직 아까울 때
- 작은 프로젝트 여러 개를 한곳에서 가볍게 관리하고 싶을 때

다음 용도로는 쓰지 않습니다.

- 운영 서비스
- 장기 유지되는 팀 소유 애플리케이션
- 별도 CI/CD, 시크릿, 배포 책임이 이미 필요한 프로젝트

## 기본 규칙

- 모든 프로젝트는 `projects/<project-name>` 아래에 둡니다.
- 각 프로젝트는 자체적으로 독립되어 있어야 합니다.
- 저장소 루트에는 프로젝트 코드를 두지 않습니다.
- 여러 프로젝트가 함께 쓰는 경우가 아니면 루트 의존성을 추가하지 않습니다.
- 시크릿은 커밋하지 않습니다. `.env` 대신 `.env.example`을 커밋합니다.
- 새 프로젝트를 추가하면 이 파일의 `Project Index`를 반드시 갱신합니다.
- 사용자 대상 문서는 `README.md`와 `README.ko.md`를 함께 두고, 상단에 언어 링크를 넣습니다.

## 권장 구조

```text
.
|-- README.md
|-- README.ko.md
|-- .gitignore
`-- projects/
    `-- <project-name>/
        |-- README.md
        |-- README.ko.md
        |-- .env.example
        |-- package.json / pyproject.toml / requirements.txt
        |-- src/
        `-- test/
```

## 빠른 시작

새 토이 프로젝트를 올릴 때는 아래 순서대로 진행합니다.

1. `kebab-case` 폴더 이름을 정합니다.
2. `projects/<project-name>/`를 만듭니다.
3. 코드, 설정, 자산은 모두 그 폴더 안에 둡니다.
4. 프로젝트용 `README.md`를 추가합니다.
5. 한글 문서가 필요하면 `README.ko.md`도 함께 추가합니다.
6. 환경변수가 있으면 `.env.example`을 추가합니다.
7. 스택에 맞는 런타임 매니페스트를 둡니다.
8. 아래 `Project Index`를 갱신합니다.

예시:

```text
projects/hgnn-incident-assistant/
projects/slack-message-lab/
projects/address-parser-demo/
```

최소 스캐폴드 예시:

```sh
mkdir -p projects/my-project/{src,test}
touch projects/my-project/README.md
touch projects/my-project/README.ko.md
touch projects/my-project/.env.example
```

## 프로젝트별 필수 파일

특별한 사유가 없으면 각 프로젝트는 아래 파일을 포함해야 합니다.

- `README.md`: 무엇인지, 왜 있는지, 어떻게 실행하는지
- `README.ko.md`: 한국어 사용자용 문서
- `.env.example`: 실제 시크릿이 빠진 환경변수 예시
- 스택 매니페스트: `package.json`, `pyproject.toml`, `requirements.txt`
- `src/`: 애플리케이션 소스 코드
- `test/` 또는 이에 준하는 테스트 위치

## 프로젝트 이름 규칙

- `kebab-case`를 사용합니다.
- 짧고 설명적인 이름을 사용합니다.
- 최종 제품명보다 실험 목적이 드러나는 이름을 선호합니다.
- `test`, `demo`, `tmp` 같은 일반적인 이름은 피합니다.

좋은 예시:

- `incident-assistant`
- `slack-collector-lab`
- `address-parser-demo`

나쁜 예시:

- `test`
- `new-project`
- `temp-final-real`

## 프로젝트 README 템플릿

각 프로젝트의 `README.md`는 아래 형태를 따르는 것을 권장합니다.

```md
# <project-name>

English | [한국어](README.ko.md)

## What It Is
One-paragraph summary of the project.

## Why It Exists
What question, workflow, or hypothesis this project is testing.

## Stack
- Node.js / Python / etc.
- Main libraries or frameworks

## How To Run
1. Setup steps
2. Install dependencies
3. Start command

## Environment Variables
- List required variables
- Point to `.env.example`

## Current Status
planned / active / paused / archived / promoted

## Next Steps
- Short list of the next things to validate
```

한국어 문서가 필요하면 `README.ko.md`를 추가하고, 상단에 반대쪽 언어 링크를 둡니다.

프로젝트 README를 읽으면 아래 질문에 답할 수 있어야 합니다.

- 이 프로젝트가 무엇을 하는지
- 왜 존재하는지
- 어떻게 실행하는지
- 무엇이 아직 미완성인지

## 프로젝트 추가 완료 기준

새 프로젝트를 머지하기 전 아래를 모두 확인합니다.

- 프로젝트가 `projects/<project-name>` 아래에 있다
- 프로젝트에 자체 `README.md`가 있다
- 필요한 경우 `README.ko.md`도 있다
- 실제 시크릿이 커밋되지 않았다
- 프로젝트 폴더에서 설치/실행 절차를 재현할 수 있다
- 루트 `Project Index`가 갱신되었다

## 상태 값

루트 인덱스와 프로젝트 README에서는 아래 값 중 하나를 사용합니다.

- `planned`: 아이디어만 있고 구현은 시작하지 않음
- `active`: 현재 탐색 또는 개발 중
- `paused`: 의도적으로 잠시 중단
- `archived`: 실험 종료, 참고용으로만 보관
- `promoted`: 별도 저장소로 분리 완료

## 별도 저장소로 분리할 시점

아래 조건 중 두 개 이상이 참이면 프로젝트를 분리합니다.

- 자체 배포 수명주기가 필요하다
- 별도 CI/CD, 시크릿, 인프라가 필요하다
- 다른 사람이 독립적으로 리뷰하거나 기여해야 한다
- 짧은 실험 단계를 넘어 계속 살아남았다
- 다른 프로젝트와 기술 스택이나 툴링이 충돌한다

## Project Index

프로젝트마다 한 줄씩 추가합니다.

| Project | Status | Summary | Path |
| --- | --- | --- | --- |
| hgnn-incident-assistant | active | Local Slack bot that analyzes AlertNow incidents with repository context | `projects/hgnn-incident-assistant` |

예시 행:

```md
| incident-assistant | active | Slack-based incident response assistant | `projects/incident-assistant` |
```

## 저장소 유지 원칙

- 루트는 최소한으로 유지합니다.
- 반쯤 만든 잡동사니를 쌓아두기보다 지우는 쪽을 선호합니다.
- 살아남은 프로젝트는 별도 저장소로 승격합니다.
- 끝난 실험은 active인 척 두지 말고 archived로 정리합니다.
