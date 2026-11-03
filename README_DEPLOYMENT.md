# LabFix v1.3.3 개발 및 배포 준비

첨부 ZIP의 UI와 기능을 보존한 안정화 버전입니다. 실제 Vercel 배포와 Gemini/Upstash 유료 API 호출은 수행하지 않았습니다.

## 로컬 개발

Node.js 24.x 및 npm을 사용합니다.

```sh
npm ci
npm test
npm start
```

`npm start`는 loopback 3000 포트에서 정적 프론트엔드와 실제 `api/analyze.js` 핸들러를 실행합니다. 별도 Vercel CLI가 필요하지 않습니다. 키가 없으면 GET 상태 확인은 200, POST 분석은 503입니다. 환경변수는 셸 또는 별도 보안 설정으로 주입합니다. `.env.local`을 사용할 경우 `node --env-file=.env.local scripts/dev-server.js`로 실행합니다. 키를 입력한 후 분석 버튼을 누르면 유료 호출이 발생할 수 있으므로 별도 승인을 받으세요.

```sh
npm run build
npm run test:browser
npm audit
```

브라우저 테스트는 Chromium이 필요합니다. 기본 `/usr/bin/chromium` 또는 `CHROMIUM_PATH`로 실행 파일을 지정하세요. 테스트는 일회성 브라우저 컨텍스트를 사용하고 API를 가로채므로 실제 사용자 데이터와 유료 서비스에 접근하지 않습니다. 서버 테스트도 네트워크 응답을 모의 처리합니다.

## Vercel 구조

- 저장소 루트: `index.html`, `api/analyze.js`, `package.json`, `vercel.json`
- Framework: Other. Build: `npm run build`. Output: `public`
- 빌드는 `index.html`만 public에 복사합니다. 테스트/문서/환경변수를 공개 출력에 넣지 마세요.
- `api/analyze.js`는 ESM Node Function입니다. 별도 Express 서버 없이 req/res API를 사용합니다.
- Node.js 24.x, 함수 최대 60초 설정. Gemini 요청 timeout은 25초이나 SDK 재시도와 플랫폼 제한에 따라 전체 소요시간은 다를 수 있습니다.

## 환경변수 (값은 저장소에 넣지 않음)

| 변수 | 용도 |
|---|---|
| GEMINI_API_KEY | 서버 전용 Gemini 키, 필수 |
| GEMINI_MODEL | 기본 gemini-2.5-flash, 배포 시 모델 사용 가능 여부 확인 |
| UPSTASH_REDIS_REST_URL | HTTPS Upstash REST 주소, 운영 필수 |
| UPSTASH_REDIS_REST_TOKEN | Upstash REST 토큰, 운영 필수 |
| ALLOW_MOCK_TEST | false 권장; production에서는 true여도 모의 요청 차단 |
| LABFIX_TEST_TOKEN | 개발 환경에서만 모의 테스트 사용 시 필요한 비공개 토큰 |
| NODE_ENV | Vercel의 production 설정 유지 |

`VERCEL`, `VERCEL_ENV`는 플랫폼이 설정합니다. 로컬에서 임의로 Vercel 신뢰 모드를 켜지 마세요. Preview도 NODE_ENV=production이면 모의 요청이 거부됩니다. 모의 테스트는 로컬 개발 환경에서 실행하세요.

## 보안 특성과 제한

- Gemini 키는 백엔드에서만 사용하며 GET은 키 존재 여부만 반환합니다.
- 운영 모의 요청은 차단되고, Redis 미설정/장애/잘못된 카운터는 fail-closed입니다.
- Redis Lua INCR+EXPIRE는 단일 스크립트로 실행합니다. 60초 동안 IP당 5회 허용, 6번째는 429입니다. 실 Redis에서 Lua/TTL 실행은 별도 승인 후 검증해야 합니다.
- Vercel에서는 플랫폼이 덮어쓰는 `x-vercel-forwarded-for`만 신뢰하고 일반 `x-forwarded-for`/`x-real-ip`는 무시합니다. Vercel 외 환경은 socket IP를 사용합니다. 다른 프록시 배포에는 별도 신뢰 정책이 필요합니다.
- IPv6 주소는 정규화합니다. IPv6 주소 회전, 다중 IP 공격을 막는 사용자 인증 기반 제한은 없으므로 Vercel WAF와 비용 한도를 함께 설정하세요. NAT 사용자들은 한 IP의 5회 한도를 공유합니다.
- 로그/코드는 분석 데이터로 전달하고 격리 지침은 SDK systemInstruction으로 설정합니다. 프롬프트 인젝션을 완전히 방지한다는 보장은 없으며 결과는 참고용으로만 사용하세요.
- UI는 textContent 기반으로 결과를 렌더링합니다. 원본 로그/코드 저장은 기본 비활성화입니다. AI 요약·해결 안내에도 입력 일부가 포함될 수 있으므로 민감정보를 입력하지 마세요.
- 브라우저 저장소의 손상된 데이터는 자동 초기화하지 않습니다. 입력 변경 후 이전 결과 저장을 차단합니다.
- GET `isProductionReady`는 실연동 미검증을 나타내기 위해 false를 유지합니다.

## 배포 전 사용자가 확인할 항목 (NOT TESTED)

이번 작업에서는 Vercel 계정/프로젝트 설정을 조회하거나 배포하지 않았습니다.

1. 별도 승인 후 Vercel 프로젝트에 저장소를 연결합니다. Preview의 Deployment Protection에서 Vercel Authentication 또는 사용 가능한 Password Protection을 활성화합니다. 로그아웃/비인증 요청이 실제 차단되는지 확인합니다. 보호 설정은 vercel.json만으로 보장되지 않습니다.
2. Preview 전용 Gemini 키/Redis 데이터베이스를 보안 환경변수로 등록하고 비용 한도를 설정합니다. 운영 환경과 분리합니다.
3. 실호출 승인 후 Arduino 업로드 오류와 Python ModuleNotFoundError를 각각 한 번 분석하여 200, 한국어 구조화 응답과 모델명을 확인합니다. 모델이 지원되지 않으면 GEMINI_MODEL을 사용 가능한 모델로 지정합니다.
4. 격리 Preview에서 동일 IP로 6회 호출해 앞 5회 처리와 6회차 429를 확인합니다. Redis 카운터와 TTL이 1~60초이고 만료 후 다시 허용되는지 확인합니다. 앞 5회에는 Gemini 요금이 발생할 수 있습니다.
5. Preview에서 Redis 설정을 제거하거나 접근 불가하도록 만든 뒤 503 차단을 확인하고 원래 설정을 복원합니다. Production 설정으로 장애 실험하지 마세요.
6. Vercel edge가 전달하는 IP, NAT 공유 영향, 함수 timeout, 모바일 뷰포트를 실배포에서 확인합니다.

실패 시: Root/Output 디렉터리와 Node 버전 → lockfile 설치 → 환경변수 적용 범위/재배포 → Gemini 모델·키 권한 → Upstash HTTPS 주소·토큰 → 함수 로그/429·503 상태 → Deployment Protection 순서로 확인하세요. 로그에 원문/키를 남기지 마세요.

## 실제 실행 결과

- 기존 테스트 12/12, 추가 보안 회귀 9/9 통과
- Chromium UI 회귀 5/5 통과 (취소/입력·탭·예제 변경, stale 저장 금지, 기록 CRUD, 기본 원본 비저장, API 실패, 손상 기록 보존, 390px 화면)
- npm audit: 취약점 0건
- 실 Gemini, Upstash, Vercel 빌드/배포 및 Preview 보호: NOT TESTED

자세한 인수인계는 `HANDOVER.md`를 참조하세요.
