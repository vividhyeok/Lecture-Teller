from __future__ import annotations

import json
import os
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
AUDIO_DIR = BASE_DIR / "audio"
DATA_FILE = BASE_DIR / "data.json"
SETTINGS_FILE = BASE_DIR / "settings.json"
OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
VALID_VOICES = ("alloy", "echo", "fable", "onyx", "nova", "shimmer")
DEFAULT_LIBRARY = {"subjects": []}
RESERVED_WINDOWS_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}

STATIC_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
load_dotenv(BASE_DIR / ".env")

data_lock = Lock()
app = FastAPI(title="Lecture Teller", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class SubjectCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class UnitCreatePayload(BaseModel):
    subject: str = Field(..., min_length=1, max_length=120)
    name: str = Field(..., min_length=1, max_length=120)


class GeneratePayload(BaseModel):
    subject: str = Field(..., min_length=1, max_length=120)
    unit: str = Field(..., min_length=1, max_length=120)
    text: str = Field(..., min_length=1)
    voice: str = Field(default="alloy")


class SettingsPayload(BaseModel):
    api_key: str = Field(default="")
    audio_dir: str = Field(default="")


def get_settings() -> dict[str, str]:
    if not SETTINGS_FILE.exists():
        return {"api_key": "", "audio_dir": ""}
    try:
        with SETTINGS_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"api_key": "", "audio_dir": ""}


def save_settings(settings: dict[str, str]) -> None:
    with SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


def get_active_audio_dir() -> Path:
    settings = get_settings()
    custom_dir = settings.get("audio_dir", "").strip()
    return Path(custom_dir) if custom_dir else AUDIO_DIR


def ensure_data_file() -> None:
    if DATA_FILE.exists():
        return
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(DEFAULT_LIBRARY, file, ensure_ascii=False, indent=2)


def load_library_unlocked() -> dict[str, Any]:
    ensure_data_file()
    with DATA_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict) or not isinstance(data.get("subjects"), list):
        return json.loads(json.dumps(DEFAULT_LIBRARY))
    return data


def save_library_unlocked(data: dict[str, Any]) -> None:
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def normalize_display_name(value: str, label: str) -> str:
    cleaned = re.sub(r"\s+", " ", value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{label} 이름을 입력하세요.")
    return cleaned


def normalize_storage_name(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "_", normalized)
    normalized = normalized.rstrip(". ")
    normalized = re.sub(r"\s+", " ", normalized)
    if not normalized:
        normalized = fallback
    if normalized.upper() in RESERVED_WINDOWS_NAMES:
        normalized = f"{normalized}_"
    return normalized[:120]


def same_name(left: str, right: str) -> bool:
    return left.casefold() == right.casefold()


def find_subject(library: dict[str, Any], subject_name: str) -> dict[str, Any] | None:
    return next(
        (subject for subject in library["subjects"] if same_name(subject["name"], subject_name)),
        None,
    )


def find_unit(subject: dict[str, Any], unit_name: str) -> dict[str, Any] | None:
    return next(
        (unit for unit in subject["units"] if same_name(unit["name"], unit_name)),
        None,
    )


def get_or_create_subject(library: dict[str, Any], subject_name: str) -> dict[str, Any]:
    subject = find_subject(library, subject_name)
    if subject:
        return subject

    storage_name = normalize_storage_name(subject_name, "subject")
    if any(same_name(item["storage_name"], storage_name) for item in library["subjects"]):
        raise HTTPException(
            status_code=409,
            detail="과목 이름이 파일 저장 규칙과 충돌합니다. 다른 이름을 사용하세요.",
        )

    subject = {"name": subject_name, "storage_name": storage_name, "units": []}
    (get_active_audio_dir() / storage_name).mkdir(parents=True, exist_ok=True)
    library["subjects"].append(subject)
    return subject


def get_or_create_unit(subject: dict[str, Any], unit_name: str) -> dict[str, Any]:
    unit = find_unit(subject, unit_name)
    if unit:
        return unit

    storage_name = normalize_storage_name(unit_name, "unit")
    if any(same_name(item["storage_name"], storage_name) for item in subject["units"]):
        raise HTTPException(
            status_code=409,
            detail="단원 이름이 파일 저장 규칙과 충돌합니다. 다른 이름을 사용하세요.",
        )

    unit = {
        "name": unit_name,
        "storage_name": storage_name,
        "voice": "alloy",
        "audio_path": None,
        "text": None,
        "created_at": None,
    }
    subject["units"].append(unit)
    return unit


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def strip_markdown(text: str) -> str:
    cleaned = text.replace("\r\n", "\n")
    cleaned = re.sub(r"```[^\n]*\n?", "", cleaned)
    cleaned = cleaned.replace("```", "")
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s{0,3}>\s?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*([-*_]\s*){3,}$", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
    cleaned = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", cleaned)
    cleaned = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"\1", cleaned)
    cleaned = re.sub(r"~~([^~]+)~~", r"\1", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def validate_voice(voice: str) -> str:
    cleaned = (voice or "").strip().lower()
    if cleaned not in VALID_VOICES:
        raise HTTPException(status_code=400, detail="지원하지 않는 음성입니다.")
    return cleaned


def sync_missing_audio(library: dict[str, Any]) -> bool:
    changed = False
    for subject in library["subjects"]:
        for unit in subject["units"]:
            audio_path = unit.get("audio_path")
            if not audio_path:
                continue
            relative_path = audio_path.lstrip("/audio/").replace("/", os.sep)
            file_path = get_active_audio_dir() / relative_path
            if not file_path.exists():
                unit["audio_path"] = None
                changed = True
    return changed


def create_speech_file(text: str, voice: str, destination: Path) -> None:
    settings = get_settings()
    api_key = settings.get("api_key", "").strip() or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY 환경변수가 없습니다. 프로젝트 루트의 .env 파일을 확인하세요.",
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_file = destination.with_suffix(".tmp")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "tts-1",
        "voice": voice,
        "input": text,
        "response_format": "mp3",
    }

    try:
        with requests.post(
            OPENAI_SPEECH_URL,
            headers=headers,
            json=payload,
            stream=True,
            timeout=300,
        ) as response:
            if response.status_code >= 400:
                try:
                    error_data = response.json()
                    detail = error_data.get("error", {}).get("message")
                except ValueError:
                    detail = None
                raise HTTPException(
                    status_code=502,
                    detail=detail or "OpenAI TTS 요청에 실패했습니다.",
                )

            with temp_file.open("wb") as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
    except requests.RequestException as exc:
        temp_file.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"TTS 통신 중 오류가 발생했습니다: {exc}") from exc

    temp_file.replace(destination)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/audio/{path:path}")
def serve_audio(path: str) -> FileResponse:
    file_path = get_active_audio_dir() / path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="오디오 파일을 찾을 수 없습니다.")
    return FileResponse(file_path)


@app.get("/api/settings")
def api_get_settings() -> dict[str, str]:
    return get_settings()


@app.post("/api/settings")
def api_save_settings(payload: SettingsPayload) -> dict[str, str]:
    settings = {
        "api_key": payload.api_key.strip(),
        "audio_dir": payload.audio_dir.strip()
    }
    save_settings(settings)
    return settings


@app.get("/api/library")
def get_library() -> dict[str, Any]:
    with data_lock:
        library = load_library_unlocked()
        if sync_missing_audio(library):
            save_library_unlocked(library)
    return {"library": library, "voices": list(VALID_VOICES)}


@app.post("/api/subjects")
def create_subject(payload: SubjectCreatePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.name, "과목")

    with data_lock:
        library = load_library_unlocked()
        if find_subject(library, subject_name):
            raise HTTPException(status_code=409, detail="이미 같은 이름의 과목이 있습니다.")
        get_or_create_subject(library, subject_name)
        save_library_unlocked(library)

    return {"library": library}


@app.delete("/api/subjects")
def delete_subject(name: str = Query(..., min_length=1)) -> dict[str, Any]:
    subject_name = normalize_display_name(name, "과목")

    with data_lock:
        library = load_library_unlocked()
        subject = find_subject(library, subject_name)
        if not subject:
            raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")

        subject_dir = get_active_audio_dir() / subject["storage_name"]
        if subject_dir.exists():
            shutil.rmtree(subject_dir, ignore_errors=True)

        library["subjects"] = [
            item for item in library["subjects"] if not same_name(item["name"], subject_name)
        ]
        save_library_unlocked(library)

    return {"library": library}


@app.post("/api/units")
def create_unit(payload: UnitCreatePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    unit_name = normalize_display_name(payload.name, "단원")

    with data_lock:
        library = load_library_unlocked()
        subject = find_subject(library, subject_name)
        if not subject:
            raise HTTPException(status_code=404, detail="먼저 과목을 선택하거나 생성하세요.")
        if find_unit(subject, unit_name):
            raise HTTPException(status_code=409, detail="이미 같은 이름의 단원이 있습니다.")
        get_or_create_unit(subject, unit_name)
        save_library_unlocked(library)

    return {"library": library}


@app.delete("/api/units")
def delete_unit(
    subject: str = Query(..., min_length=1),
    name: str = Query(..., min_length=1),
) -> dict[str, Any]:
    subject_name = normalize_display_name(subject, "과목")
    unit_name = normalize_display_name(name, "단원")

    with data_lock:
        library = load_library_unlocked()
        subject_item = find_subject(library, subject_name)
        if not subject_item:
            raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")

        unit = find_unit(subject_item, unit_name)
        if not unit:
            raise HTTPException(status_code=404, detail="단원을 찾을 수 없습니다.")

        audio_file = get_active_audio_dir() / subject_item["storage_name"] / f"{unit['storage_name']}.mp3"
        if audio_file.exists():
            audio_file.unlink(missing_ok=True)

        subject_item["units"] = [
            item for item in subject_item["units"] if not same_name(item["name"], unit_name)
        ]
        save_library_unlocked(library)

    return {"library": library}


@app.post("/api/generate")
def generate_tts(payload: GeneratePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    unit_name = normalize_display_name(payload.unit, "단원")
    cleaned_text = strip_markdown(payload.text)
    voice = validate_voice(payload.voice)

    if not cleaned_text:
        raise HTTPException(status_code=400, detail="변환할 텍스트가 없습니다.")
    if len(cleaned_text) > 4096:
        raise HTTPException(
            status_code=400,
            detail="정리된 텍스트가 4096자를 초과했습니다. 단원을 나눠서 변환하세요.",
        )

    with data_lock:
        library = load_library_unlocked()
        subject = get_or_create_subject(library, subject_name)
        unit = get_or_create_unit(subject, unit_name)
        save_library_unlocked(library)
        subject_storage_name = subject["storage_name"]
        unit_storage_name = unit["storage_name"]

    audio_file = get_active_audio_dir() / subject_storage_name / f"{unit_storage_name}.mp3"
    create_speech_file(cleaned_text, voice, audio_file)

    with data_lock:
        library = load_library_unlocked()
        subject = get_or_create_subject(library, subject_name)
        unit = get_or_create_unit(subject, unit_name)
        unit["voice"] = voice
        unit["audio_path"] = f"/audio/{subject['storage_name']}/{unit['storage_name']}.mp3"
        unit["text"] = payload.text
        unit["created_at"] = now_iso()
        save_library_unlocked(library)

    return {
        "library": library,
        "cleaned_text": cleaned_text,
        "unit": {
            "subject": subject_name,
            "name": unit_name,
            "voice": voice,
            "audio_path": unit["audio_path"],
            "text": unit["text"],
            "created_at": unit["created_at"],
        },
    }
