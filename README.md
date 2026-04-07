# LectureTeller 🎙

강의 대본을 붙여넣으면 OpenAI TTS로 MP3를 만들어주는 도구입니다.

---

## 빠른 시작

```
start.bat   # 서버 시작 + 브라우저 자동 열기
stop.bat    # 서버 종료
```

> **처음 설치할 때만** 아래 명령을 한 번 실행하세요:
>
> ```
> py -m venv .venv
> .venv\Scripts\activate
> pip install -r requirements.txt
> ```

---

## 사용법

1. **대본 편집** 탭에서 텍스트 붙여넣기
2. 상단 **음성 만들기** 클릭 → MP3 자동 생성
3. 생성 완료 후 플레이어로 즉시 재생

### 플레이어 단축키 (전역 — 재생 중 입력 불필요)

| 키 | 동작 |
|---|---|
| `A` | 처음부터 |
| `S` | −10초 |
| `D` | 재생 / 정지 |
| `F` | +10초 |
| `G` | 정지 |
| `← →` | −10초 / +10초 |

> 편집기에 커서가 있을 때는 단축키가 비활성화됩니다.

### 저장 / 생성 단축키

| 키 | 동작 |
|---|---|
| `Ctrl + S` | 대본 저장 |
| `Ctrl + Enter` | 음성 만들기 |

---

## 파일 구조

```
lectureteller/
├── start.bat            # 서버 시작
├── stop.bat             # 서버 종료
├── app.py               # FastAPI 백엔드
├── data_simple.json     # 대본 데이터
├── audio/               # 생성된 MP3
├── settings.json        # API 키, 음성 등 설정
├── static-v2/           # React 빌드 결과물 (자동 생성)
└── lectureteller-react/ # React 소스
```

---

## 설정

브라우저 오른쪽 상단 ⚙️ 설정에서:
- **OpenAI API 키** 입력
- **기본 음성** 선택 (alloy, echo, fable, onyx, nova, shimmer)

또는 `.env` 파일에:

```
OPENAI_API_KEY=sk-...
```

---

## 개발 / 프론트엔드 수정

```bash
cd lectureteller-react
npm install
npm run dev      # 개발 서버 (hot reload, port 5173)
npm run build    # static-v2/ 에 빌드 → 백엔드에서 서빙
```
