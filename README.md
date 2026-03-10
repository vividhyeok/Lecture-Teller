# Lecture Teller

Claude가 만든 구어체 강의 텍스트를 OpenAI `tts-1` 음성으로 변환해 로컬에서 바로 재생하는 개인용 웹앱입니다.

## 기능

- FastAPI 기반 로컬 서버
- 단일 `index.html` UI
- 과목 / 단원 아코디언 사이드바
- OpenAI TTS 생성 후 `audio/과목명/단원명.mp3` 저장
- `data.json` 하나로 메타데이터 관리
- 과목 삭제 시 하위 단원과 MP3 일괄 삭제
- 단원 삭제 시 해당 MP3도 함께 삭제

## 최초 설치

1. 가상환경 생성

```bat
py -m venv .venv
```

2. 가상환경 활성화

```bat
.venv\Scripts\activate
```

3. 패키지 설치

```bat
pip install -r requirements.txt
```

4. 프로젝트 루트에 `.env` 파일 생성

```env
OPENAI_API_KEY=여기에_본인_OpenAI_API_키
```

## 실행 / 종료

- 실행: `start.bat`
- 종료: `stop.bat`

`start.bat`는 `.venv`를 사용해 `uvicorn` 서버를 띄우고 브라우저에서 `http://127.0.0.1:8000`을 자동으로 엽니다.

## 사용 방법

1. 좌측에서 과목을 추가합니다.
2. 과목 안에 단원을 추가합니다.
3. 단원을 선택합니다.
4. Claude 응답 텍스트를 붙여넣습니다.
5. 목소리를 고른 뒤 `변환 및 저장`을 누릅니다.
6. 생성된 오디오를 우측 플레이어에서 바로 재생합니다.

## 저장 구조

- MP3: `audio/<과목명>/<단원명>.mp3`
- 메타데이터: `data.json`

Windows 파일명에 사용할 수 없는 문자가 과목명/단원명에 포함되면 저장 경로에서는 자동으로 `_`로 치환됩니다.

## 참고

- OpenAI API 키는 `.env`의 `OPENAI_API_KEY`를 사용합니다.
- TTS 모델은 고정으로 `tts-1`입니다.
- UI에서 선택 가능한 기본 음성은 `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`입니다.
- 정리된 텍스트가 4096자를 넘으면 OpenAI TTS 제한에 맞게 나눠서 저장해야 합니다.
