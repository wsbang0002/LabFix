# LabFix v1.3.3 인수인계 결과

검증일: 2026-11-03. 저장소: https://github.com/wsbang0002/LabFix, 브랜치: main.

## 복원 및 업로드

- PASS: ZIP CRC 무결성 및 모든 항목의 상대경로/상위 경로/심볼릭 링크 검사. 필수 7개 파일 모두 존재.
- 원본 ZIP SHA256: `fd3ceeb85670d27fd21212854100c38b5c159e7be1b8d9df761e453d400a5c42`
- PASS: 작업 전 원격 refs가 없는 빈 저장소 확인. 기존 사용자 파일과 커밋 이력 삭제/재작성 없음.
- PASS: 초기 커밋 `931567d`, `chore: import LabFix v1.3.3 project`를 main에 push.
- PASS: 실제 파일 검토에서 미구현 생략 블록 없음. `...`는 표시 문구/JavaScript 전개 연산자로 사용됨. 키 템플릿 및 테스트 문자열은 실 자격증명이 아님.
- 안정화 커밋: `fix: stabilize LabFix backend and frontend`. 최종 SHA는 `git rev-parse HEAD` 또는 GitHub main에서 확인.

## 발견 결함과 수정

| 발견 당시 상태 | 결함 | 조치 |
|---|---|---|
| FAIL → 수정 | 존재하지 않는 @google/genai ^0.1.1 때문에 npm install 실패 | SDK 1.52.0, lockfile 생성 및 실제 SDK 요청 직렬화 모의 검증 |
| FAIL → 수정 | package.json 1.3.1 표기 | 1.3.3 및 Node 24.x 지정 |
| FAIL → 수정 | npm start가 미설치 vercel CLI에 의존 | 외부 CLI 없는 로컬 개발 서버 제공 |
| FAIL → 수정 | 임의 x-forwarded-for/x-real-ip로 rate-limit 키 변경 가능 | Vercel 플랫폼 헤더만 신뢰, 그 외 socket 사용, IPv6 정규화 |
| FAIL → 수정 | false/0 선택 입력값 검증 우회 | JSON 객체 및 선택 입력 문자열 타입 검사 |
| FAIL → 수정 | AI causes/steps null 요소에서 TypeError/500 | 구조 검사 후 정상적인 upstream 오류 502 처리 |
| FAIL → 수정 | 시스템 격리 지침을 사용자 입력과 동일 role에 연결 | SDK systemInstruction으로 분리 |
| FAIL → 수정 | 데모 취소 후 busy 문구 잔류 | 두 버튼 문구를 공통 상태 처리에서 복원 |
| FAIL → 수정 | Redis 미설정으로 단정하는 배너 | 실연동 미검증 상태를 정확히 표시 |
| 개선 | 개발 메모리 제한 저장소 무한 증가 위험 | 만료 키 정리 및 키 수 상한 |
| 개선 | Redis 카운터 이상값 허용 | 유효한 양의 정수 확인 및 운영 fail-closed |
| 개선 | 공개 정적 출력에 테스트/문서가 섞일 가능성 | index.html만 public으로 빌드, Vercel outputDirectory 명시 |

## 실행 증거

- Node.js v24.22.1, npm 11.9.0
- @google/genai 1.52.0, @upstash/redis 1.41.0, @playwright/test 1.64.1
- PASS: npm install, lockfile 생성, npm ci 재설치, npm ls (누락/충돌 없음)
- PASS: npm test — 기존 12개 + 보안 회귀 9개, 실패 0. 기존 케이스 삭제 없음. IP 검증은 신뢰 헤더 정책에 맞게 갱신하고 6번째 차단 테스트는 앞 5회 성공까지 강화함. GET 테스트는 키 값 부재도 확인함.
- PASS: npm run test:browser — 실제 Chromium 5/5. 입력·탭·예제 요청 취소, 데모 버튼 복원, stale 저장 금지, localStorage CRUD/기본 원본 비저장, 손상 데이터 보존, API 실패 시 데모 미생성, 390px overflow 검사.
- PASS: npm run build, backend/dev-server/inline frontend JavaScript 문법 검사.
- PASS: 로컬 개발 서버 HTTP 검사 — UI 200, GET 상태 200, 키 없는 POST 503, 잘못된 JSON 400, 비공개 파일 경로 404.
- PASS: npm audit — 취약점 0. 전이 패키지 node-domexception의 deprecation 알림은 존재함.
- PASS: 비밀키 패턴 및 수동 환경 템플릿 검토. .env*, node_modules, .vercel, 빌드/테스트 산출물 커밋 제외.

## 보안 및 운영 제한

- API 키는 서버 전용. 운영 모의 차단과 Redis fail-closed를 실제 핸들러에 대한 모의 네트워크 테스트로 검증함.
- Redis Lua는 INCR와 최초 EXPIRE를 단일 스크립트로 수행하도록 검토함. SDK에 전달되는 명령과 6회차 차단은 검증했으나 실제 Redis에서 원자성/TTL을 실행하지 않음.
- 프론트엔드는 textContent 기반. localStorage 기본 원본 비저장이나 AI 요약/점검 내용은 민감정보를 포함할 수 있음.
- 프롬프트 인젝션 격리 지침은 방어층이며 완전한 방어를 보장하지 않음. 실제 모델에 대한 적대적 프롬프트 검증은 NOT TESTED.
- NAT 사용자들은 IP당 5회/분 한도를 공유. IPv6 주소 회전과 분산 IP 공격에는 별도 플랫폼 비용/보안 제한이 필요함.
- Vercel 외 프록시 환경은 socket IP를 공유할 수 있으므로 별도 신뢰 설정 필요.

## 배포 평가 및 다음 행동

구조상 Vercel 배포 준비는 완료했지만 실제 배포 성공을 확인한 상태는 아님.

- NOT TESTED: 실제 Vercel 빌드/배포/라우팅, Preview 접근 보호, 실 Gemini 모델·키 권한과 응답, 실 Upstash Lua/TTL·네트워크 장애, Vercel edge 헤더 동작.
- 미해결 로컬 테스트 FAIL 또는 업로드 BLOCKED 항목 없음. 실서비스 작업은 요청 범위에 따라 수행하지 않음.
- 실제 키/토큰은 생성·저장하지 않았고 Gemini/Upstash 실호출 및 Vercel 배포는 수행하지 않음.
- 사용자는 별도 승인 후 `README_DEPLOYMENT.md`의 Preview 보호·보안 환경변수·실연동 절차를 진행해야 함. 키를 채팅이나 Git에 입력하지 말 것.
- 클라우드 재사용용 install_script/start_skill 초안을 저장함. 환경 설정에서 검토·저장 후 환경을 게시해야 활성화되며, 새 태스크 복원은 아직 NOT TESTED. 환경 게시는 Vercel 배포와 별개임.
