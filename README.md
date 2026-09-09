# LectureTeller 🎙

강의 대본을 **듣기 좋은 TTS 음성으로 만들고, 학기·과목별로 관리하면서 반복 학습하는 로컬 도구**입니다.

기존의 `대본 → 음성 만들기 → 재생` 흐름은 그대로 유지하면서, 반복적으로 하던 STT 보정·강의 대본화 프롬프트 작업과 자료 관리를 가볍게 보완합니다.

---

## 가장 쉬운 설치

GitHub **Releases**에서 최신 Windows 설치파일을 내려받아 실행하면 됩니다.

```text
LectureTeller_*_x64-setup.exe
```

Release 빌드는 GitHub Actions가 Windows 환경에서 자동으로 수행합니다. 로컬 PC에 Python, Node.js, Rust, PyInstaller를 설치할 필요가 없습니다.

### 새 버전 Release 만들기

GitHub에서:

```text
Actions
→ Build Windows Release
→ Run workflow
→ version 입력 (예: 1.1.0)
```

하면 다음 과정이 자동으로 실행됩니다.

```text
React production build
→ Python FastAPI sidecar를 PyInstaller EXE로 빌드
→ Tauri NSIS Windows installer 생성
→ v1.1.0 태그 및 GitHub Release 생성
→ setup.exe 업로드
```

`v*` 태그를 직접 푸시하거나 `release-v*` 브랜치를 푸시해도 동일한 Release workflow가 실행됩니다.

---

## 개발용 빠른 시작

```bat
start.bat   # 필요한 경우 프론트엔드 자동 빌드 → 서버 시작 → 브라우저 열기
stop.bat    # 서버 종료
```

처음 설치할 때만:

```bat
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

새 UI 소스가 변경된 첫 실행에는 Node.js가 필요합니다. `start.bat`이 `node_modules`가 없으면 `npm ci`를 한 번 실행하고 이후에는 소스 해시가 바뀐 경우에만 다시 빌드합니다.

---

## 기본 사용법

### 가장 단순한 기존 방식

1. **학습 대본** 탭에 완성 대본을 붙여넣습니다.
2. 이번에 사용할 **voice**를 선택하고 `미리듣기`로 확인합니다.
3. **음성 만들기**를 누릅니다.
4. 생성된 MP3를 바로 재생하거나 다운로드합니다.

대본별 TTS 생성 요청에는 화면에서 선택한 voice가 **명시적으로 전달**됩니다.

### STT부터 정리하는 방식

한 강의는 필요에 따라 세 층으로 관리할 수 있습니다.

```text
원본 STT / 자료
      ↓
보정본
      ↓
학습 대본
      ↓
TTS
```

- **원본 STT / 자료**: 교수 강의, YouTube 전사본 등 원문 보관
- **보정본**: STT 오류만 고친 버전
- **학습 대본**: 실제 TTS로 들을 최종 대본

세 단계를 모두 사용할 필요는 없습니다. 완성 대본만 있다면 기존처럼 **학습 대본 탭 하나만 사용**하면 됩니다.

---

## 고정 AI 프롬프트

LectureTeller에는 버전이 고정된 설명 프롬프트가 있습니다.

현재 기본 버전:

```text
structured-lecture-v1.0
```

강의 대본 프롬프트는 다음 원칙을 계속 동일하게 적용합니다.

- 전체 구조를 먼저 제시
- 정의보다 필요한 이유를 먼저 설명
- 문제 → 개념 순으로 자연스럽게 도출
- 추상 개념에 실제 이해를 돕는 예시 연결
- 개념 사이의 인과 관계 유지
- 앞에서 배운 내용을 필요한 순간 다시 호출
- 긴 설명 중 현재 위치를 안내
- 핵심과 세부사항의 중요도 구분
- 의미 있는 반복과 재진술
- 원본 강의의 설명 범위를 임의로 요약·삭제하지 않음
- TTS로 들었을 때 자연스러운 구두 대본 작성

특정 강사의 고유한 문구나 말버릇을 복제하지 않고, **좋은 강의에서 추출한 설명 설계 원리**만 고정합니다.

### 외부 ChatGPT 사용

`고정 강의 프롬프트` 버튼을 누르면 현재 자료가 포함된 완성 프롬프트를 만들고 복사할 수 있습니다.

이 방식을 쓰면 ChatGPT의 파일·검색·대화 환경을 그대로 활용하면서도 매번 즉흥적으로 프롬프트를 다시 만들 필요가 없습니다.

### API로 바로 생성

`API로 바로 대본 생성`은 **외부 복사용과 동일한 프롬프트 빌더**를 사용해 설정된 OpenAI text model로 직접 실행합니다.

따라서 동일 자료로:

- 외부 ChatGPT 결과
- Direct API 결과

를 실제로 비교한 뒤 원하는 방식을 기본으로 사용할 수 있습니다.

### 추가 프롬프트

- **STT 보정 프롬프트**: 내용·순서·발화 흐름을 유지하면서 명확한 STT 오류만 수정
- **누락 검수 프롬프트**: 원본과 학습 대본을 비교해 실제로 빠진 설명만 점검

---

## 자료 관리

각 대본에 선택적으로 다음 두 값만 붙일 수 있습니다.

```text
시기 / 컬렉션: 2026-2, 임용, YouTube ...
과목 / 분야: 운영체제, 정보통신, CS ...
```

예:

```text
2026-2
├─ 운영체제
├─ 정보통신
└─ 데이터마이닝

YouTube
├─ CS
└─ AI
```

둘 다 비워도 되며 기존 대본은 자동으로 `미분류 / 기타`에 표시됩니다.

추가로:

- 제목·과목·대본 전체 검색
- 컬렉션 빠른 필터
- 즐겨찾기
- 최근 수정 순 정렬
- 마지막 재생 위치 자동 저장

을 지원합니다.

부가 메타데이터는 기존 대본 JSON을 깨지 않고 별도 `lecture_meta.json`에 저장됩니다.

---

## TTS / 플레이어

### Voice

현재 백엔드가 지원하는 voice:

- `alloy`
- `echo`
- `fable`
- `onyx`
- `nova`
- `shimmer`

설정의 기본 voice와 별개로 **각 생성 직전에 사용할 voice를 직접 확인하고 선택**할 수 있습니다.

`미리듣기`는 모든 voice를 동일한 한국어 강의 문장으로 재생하므로 차이를 비교하기 쉽습니다.

### 단축키

편집기에 커서가 없을 때:

| 키 | 동작 |
|---|---|
| `A` | 처음부터 |
| `S` | −10초 |
| `D` | 재생 / 일시정지 |
| `F` | +10초 |

재생 위치는 약 5초 간격 및 일시정지 시 자동 저장되어 다음에 같은 강의를 열었을 때 이어서 들을 수 있습니다.

---

## 주요 파일

```text
Lecture-Teller/
├── app.py                         # 기존 FastAPI 백엔드
├── stable_routes.py               # 고정 프롬프트 / 메타데이터 API
├── server_entry.py                # 기존 앱 + stable routes 결합
├── start.bat
├── stop.bat
├── data_simple.json               # 기존 대본 데이터
├── lecture_meta.json              # 분류·원본·보정본·재생 위치 (로컬 생성)
├── audio/
├── settings.json
├── static-v2/                     # 빌드된 React UI
├── .github/workflows/
│   ├── ci.yml
│   └── release-windows.yml        # Windows setup.exe 자동 Release
└── lectureteller-react/
    └── src/
        ├── AppStable2.tsx
        └── AppStable.css
```

---

## 개발

```bash
cd lectureteller-react
npm ci
npm run dev
npm run build
```

CI에서는 Python 엔트리포인트 컴파일과 React production build를 모두 확인합니다.
