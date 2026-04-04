# LectureTeller

LectureTeller는 `외부 STT / 외부 AI 결과 -> 학습용 TTS 자산` 흐름에 맞춘 로컬 앱이다.

지금 기준 메인 제품은 React v2이며, 루트 `/`에서 바로 열린다. 핵심 작업 흐름은 아래와 같다.

1. NotebookLM 같은 외부 도구에서 만든 STT 본문을 붙여넣는다.
2. PDF / PPT 텍스트와 메모를 함께 넣는다.
3. 교수 프로필과 출력 타입을 선택한다.
4. 앱에서 완성 프롬프트를 조립해 Claude / ChatGPT 등에 복붙한다.
5. 외부 AI 결과 대본을 다시 가져와 버전별로 저장한다.
6. 원하는 버전으로 TTS를 생성하고 반복 학습한다.

## 현재 구조

- 백엔드: FastAPI
- 프론트엔드: React + TypeScript + Zustand
- 저장소: `data_v2.json`, `settings.json`, `audio/`
- 빌드 산출물: `static-v2/`

## 주요 기능

- 과목 / 세션 / 클립 단위 관리
- 교수 프로필 CRUD
- STT / PDF / 메모 저장
- 프롬프트 조립
- OpenAI 기반 대본 생성
- 외부 AI 결과 대본 버전 저장
- 버전 선택 후 TTS 생성
- 반복 청취용 플레이어

## 실행

### 1. 의존성 설치

백엔드:

```bash
pip install -r requirements.txt
```

프론트엔드:

```bash
cd lectureteller-react
npm install
```

### 2. 프론트 빌드

```bash
cd lectureteller-react
npm run build
```

### 3. 서버 실행

```bash
.\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

브라우저:

```text
http://127.0.0.1:8000/
```

## 설정

`settings.json` 또는 앱 설정 모달에서 아래 항목을 관리한다.

- `api_key`
- `audio_dir`
- `default_voice`
- `default_text_model`

## 참고

- `/v2` 경로도 계속 열리지만, 기본 진입점은 이제 `/`다.
- 기존 정적 v1 파일은 남아 있어도 메인 UI로는 사용하지 않는다.
