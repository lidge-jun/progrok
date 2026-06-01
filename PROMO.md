# [개념글 예약] SuperGrok / X Premium 결제해두고 API key 아깝던 놈들 필독 (Grok OAuth 프록시 progrok 배포)

형들, X Premium이나 SuperGrok 매달 구독료 내면서 브라우저 웹 UI로 노가다만 뛰고 있었냐?
API key 발급받자니 비용 이중지출이라 돈 아까웠던 갤러들을 위해 **Grok OAuth 프록시 `progrok`** 만들어서 배포한다.

Hermes Agent나 OpenClaw 쓰는 빌런들은 알겠지만, 걔네가 쓰는 xAI 공용 OAuth client ID (`b1a00...`) 기반 세션을 그대로 로컬 API로 바인딩해주는 도구임.

---

### 1. 이게 대체 뭐하는 물건임?
- **내 계정 세션 그대로 사용**: OAuth PKCE / Device Code 로그인 한 번 해두면 로컬에 세션 저장되고 자동 갱신됨.
- **OpenAI 호환 프록시**: 로컬 포트 `127.0.0.1:18645`에 프록시 서버 띄워줌. SDK나 에이전트, Cursor, OpenClaw에서 API 주소만 로컬로 바꾸고 API key는 아무거나 넣으면 작동함.
- **CLI & Web UI 탑재**: 머신러닝/에이전트 연동용 CLI 커맨드는 물론이고, `progrok chat` 치면 로컬 웹 챗 UI까지 바로 열림.

---

### 2. 주요 기능 및 커맨드
귀찮게 웹 UI 갈 필요 없이 터미널에서 다 됨:
*   `progrok login` : 브라우저 켜지면서 깔끔하게 OAuth 로그인. SSH/원격 서버용 `--device-code`도 됨.
*   `progrok proxy` : OpenAI 호환 서버 작동 시작.
*   `progrok search "<검색어>"` : 웹 검색이랑 실시간 X 검색(citations 포함) 결과 바로 긁어옴. `--reasoning high` 옵션으로 추론 깊이 조절 가능.
*   `progrok image "<프롬프트>"` : Imagine 기반 이미지 생성 및 이미지 에디팅.
*   `progrok video "<프롬프트>"` : 이번에 새로 나온 Grok Video 1.5(T2V, I2V, Edit, Extend) 비동기 생성 및 다운로드까지 터미널에서 올클리어.

---

### ⚠️ 3. 뇌절 금지 및 핵심 경고 (매우 중요)
사용하기 전에 이거 안 읽고 나중에 계정 터졌다고 징징대면 국물도 없다.

1.  **비공식 우회 프록시 리스크**:
    이 도구는 공식 API key 발급 경로가 아니라, Hermes Agent나 공식 앱이 사용하는 OAuth 인증 라인을 로컬 프록시 형태로 연동하는 거다.
2.  **언제든 터질 수 있음**:
    Hermes에서 공식 지원하지 않거나 웹 UI 전용 비공식 표면(특히 이미지/비디오 우회 생성 등)은 xAI 측에서 패치하면 **언제든지 예고 없이 기능이 동작하지 않거나 터질 수 있음**.
3.  **계정 정지 및 Suspension 책임은 본인에게**:
    비공식 API를 통한 과도한 호출, 봇 탐지 정책 위반 등으로 인해 발생할 수 있는 **X/xAI 계정 제한, 정지(Suspension), 구독 해지 등의 모든 책임은 100% 사용자 본인**에게 있다. 쫄리면 정식 API 요금제 결제해서 써라. 리스크 테이킹할 놈들만 쓰셈.
4.  **로컬 보안 주의**:
    기본적으로 로컬호스트(`127.0.0.1`)에만 바인딩되니까 포트 외부로 그냥 열지 마라. 세션 털리면 네 계정으로 결제되거나 털린다.

---

### 4. 어떻게 씀? (설치 및 실행)
Node.js 18 이상만 있으면 글로벌 설치 한 방에 끝난다.

```bash
# 글로벌 설치
npm install -g progrok

# 세션 활성화 (로그인)
progrok login

# OpenAI 호환 로컬 프록시 시작
progrok proxy

# CLI로 다이렉트 검색 테스트
progrok search "Node.js 22 신기능" --web
```

*   **GitHub 레포**: [github.com/lidge-jun/progrok](https://github.com/lidge-jun/progrok)
*   **공식 문서 사이트**: [lidge-jun.github.io/progrok](https://lidge-jun.github.io/progrok/)

써보고 버그 제보나 PR은 언제나 환영한다. 념글(개념글) 보내줘라 형들!
