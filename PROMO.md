# [개념글 예약] SuperGrok 세션을 로컬 API·보이스·웹앱으로 쓰는 progrok 3.0.0

SuperGrok이나 X 구독은 해뒀는데, 개발 도구에서 쓰려면 또 API 키부터 준비해야 해서 애매했던 사람들을 위한 로컬 도구다. `progrok login`으로 xAI OAuth 로그인을 한 번 해두면 그 세션을 HTTP API, CLI, WebSocket 클라이언트, 웹앱에서 같이 쓸 수 있다.

이건 무료 호출 우회기가 아니다. 계정 권한, 쿼터, 과금, 이용 제한은 전부 xAI 정책을 그대로 따른다.

## 1. 3.0.0에서 달라진 점

- `127.0.0.1:18645/v1/*`의 HTTP 프록시는 Chat/Responses SSE를 직접 파싱하고 다시 렌더링한다. 파일·오디오 같은 바이너리/멀티파트 경로는 검증된 릴레이로 보낸다.
- Responses, realtime Voice, streaming STT/TTS는 로컬 프록시를 거치지 않고 `wss://api.x.ai/v1/*`에 직접 붙는 타입드 클라이언트를 제공한다.
- `progrok tts`, `progrok stt`, `progrok live` 명령이 추가됐다. `live`는 마이크 앱이 아니라 Realtime 이벤트를 NDJSON stdin/stdout으로 연결하는 명령이다.
- `progrok chat`은 `127.0.0.1:18646`에서 Chat·Voice·Media 세 탭의 워크스페이스를 연다. 톱바가 서빙 엔드포인트, 카탈로그 모델 수, 현재 모델을 실측값으로 표시하고, Voice 탭은 9가지 연결 상태와 실제 오디오에 반응하는 입출력 레벨 미터, 음소거, 경과 시간, 수신 이벤트 로그를 제공한다.
- batches, files, collections search, embeddings, skills, models, images, videos와 Responses WebSocket을 다루는 타입드 surface client가 들어갔다.

## 2. 바로 써보기

```bash
npm install -g progrok
progrok login

# OpenAI 호환 HTTP
progrok proxy

# 로컬 웹앱
progrok chat

# Voice CLI
progrok tts "안녕하세요" --voice eve --language ko --output hello.mp3
progrok stt meeting.wav --language ko --diarize --json
progrok live --event '{"type":"session.update","session":{"voice":"eve"}}' --once
```

HTTP 클라이언트는 `http://127.0.0.1:18645/v1`을 base URL로 잡고 API 키 자리에 비어 있지 않은 임의 값을 넣으면 된다. progrok이 그 값을 버리고 로컬에 저장된 OAuth bearer로 교체한다.

## 3. Voice에서 꼭 알아둘 계약

- REST TTS의 `output_format`은 문자열이 아니라 `{ "codec": "mp3" }` 같은 객체다.
- REST STT multipart는 언어·화자 분리 같은 메타 필드를 먼저 넣고 `file`을 마지막에 넣어야 한다.
- 브라우저 realtime/STT는 연결할 때마다 `POST /v1/realtime/client_secrets`로 새 secret을 발급한다.
- secret 하나는 WebSocket 연결 한 번만 열 수 있다. 재연결할 때도 새로 발급해야 하며 캐시하거나 재사용하면 안 된다.
- secret은 URL이나 bearer header가 아니라 `xai-client-secret.<token>` WebSocket 서브프로토콜로 한 번만 전달한다.
- 브라우저 TTS의 ephemeral 인증은 아직 실측 보장하지 않는다. streaming TTS는 서버측 bearer를 쓴다.
- Voice 모델은 `grok-voice-latest`가 rolling alias이고, 재현성이 필요하면 `grok-voice-think-fast-2.0`을 고정한다.

## 4. 모델·메타데이터

정적 모델 목록은 금방 낡는다. 현재 계정에서 실제로 보이는 목록은 아래 명령으로 확인한다.

```bash
progrok models --detail
progrok capabilities --json
```

3.0.0의 capabilities는 schema v2다. `commands`가 문자열 배열이 아니라 `{ name, summary, mutatesRemote, json }` 객체 배열이므로 기존 자동화는 `commands.map(entry => entry.name)`으로 읽어야 한다.

## 5. 주의사항

1. 기본 바인딩은 localhost다. 인증 장치 없이 포트를 외부에 열지 마라.
2. `~/.progrok/auth.json`은 계정 크리덴셜이다. 커밋·공유·클라우드 동기화하지 마라.
3. WebSocket은 로컬 포트가 아니라 xAI에 직접 연결한다. 브라우저에는 OAuth 토큰을 넘기지 않는다.
4. 모델 접근 권한과 가격은 런타임 카탈로그와 현재 xAI 계정 조건이 기준이다.
5. ima2-gen v3.16.1 이후에는 progrok을 번들하거나 대신 실행하지 않는다. 두 도구는 `~/.progrok/auth.json`의 경로와 스키마만 공유한다.

- GitHub: [github.com/lidge-jun/progrok](https://github.com/lidge-jun/progrok)
- 문서: [lidge-jun.github.io/progrok](https://lidge-jun.github.io/progrok/)
