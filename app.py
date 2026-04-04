from __future__ import annotations

import json
import os
import re
import shutil
import unicodedata
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from mutagen.mp3 import MP3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
AUDIO_DIR = BASE_DIR / "audio"
DATA_FILE = BASE_DIR / "data.json"
DATA_V2_FILE = BASE_DIR / "data_v2.json"
SIMPLE_DATA_FILE = BASE_DIR / "data_simple.json"
SETTINGS_FILE = BASE_DIR / "settings.json"
OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
VALID_VOICES = ("alloy", "echo", "fable", "onyx", "nova", "shimmer")
DEFAULT_LIBRARY = {"subjects": []}
DEFAULT_V2_LIBRARY = {"subjects": [], "profiles": []}
DEFAULT_SIMPLE_LIBRARY = {"items": []}
DEFAULT_TEXT_MODEL = "gpt-4o"
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
app = FastAPI(title="Lecture Teller", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

STATIC_V2_DIR = BASE_DIR / "static-v2"
AUDIO_DIR_RUNTIME = BASE_DIR / "audio"

# Mount React build (if it exists — built by `npm run build` in lectureteller-react/)
if STATIC_V2_DIR.exists():
    app.mount("/v2", StaticFiles(directory=STATIC_V2_DIR, html=True), name="static-v2")

# Mount audio files
app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR_RUNTIME)), name="audio")


def get_frontend_index_file() -> Path:
    if STATIC_V2_DIR.exists():
        return STATIC_V2_DIR / "index.html"
    return STATIC_DIR / "index.html"


def frontend_index_response() -> FileResponse:
    return FileResponse(
        get_frontend_index_file(),
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )



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


class QuickTtsPayload(BaseModel):
    text: str = Field(..., min_length=1)
    voice: str | None = Field(default=None)


class SimpleScriptPayload(BaseModel):
    item_id: str | None = Field(default=None)
    title: str = Field(default="")
    text: str = Field(default="")


class SimpleGeneratePayload(SimpleScriptPayload):
    voice: str | None = Field(default=None)


class SettingsPayload(BaseModel):
    api_key: str = Field(default="")
    audio_dir: str = Field(default="")
    default_voice: str = Field(default="")
    default_text_model: str = Field(default="")


# ── v2 Payload models ────────────────────────────────────────────────────────

class ClipCreatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    clip_type: str = Field(default="lecture")


class V2GeneratePayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    text: str = Field(default="")
    voice: str = Field(default="alloy")
    script_version_id: str | None = Field(default=None)


class GenerateSummaryPayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    prompt: str = Field(...)


class ProfessorProfilePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    repetition_style: str = Field(default="")
    ppt_reading_ratio: str = Field(default="")
    concept_compression_style: str = Field(default="")
    difficulty_level: str = Field(default="")
    extra_rules: str = Field(default="")


class UpdateProfessorProfilePayload(ProfessorProfilePayload):
    id: str = Field(..., min_length=1)


class ClipSourcePayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    transcript_raw: str = Field(default="")
    pdf_text: str = Field(default="")
    notes: str = Field(default="")
    prompt_profile_id: str | None = Field(default=None)
    output_type: str = Field(default="explain")
    extra_instructions: str = Field(default="")


class ComposePromptPayload(ClipSourcePayload):
    prompt_profile_id: str | None = Field(default=None)


class GenerateScriptPayload(ClipSourcePayload):
    label: str = Field(default="")


class SaveScriptVersionPayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    label: str = Field(default="")
    output_type: str = Field(default="explain")
    source: str = Field(default="external-ai")
    prompt_text: str = Field(default="")
    text: str = Field(..., min_length=1)


class SelectScriptVersionPayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    script_version_id: str = Field(..., min_length=1)


class StudyChecksPayload(BaseModel):
    listen: bool = Field(default=False)
    review: bool = Field(default=False)
    memorize: bool = Field(default=False)


class StudyBookmarkPayload(BaseModel):
    id: str = Field(default="")
    kind: str = Field(default="focus")
    label: str = Field(default="")
    text: str = Field(default="")
    start: float = Field(default=0.0)
    end: float = Field(default=0.0)
    created_at: str | None = Field(default=None)


class StudyStatePayload(BaseModel):
    clip_id: str = Field(..., min_length=1)
    note: str = Field(default="")
    recall_note: str = Field(default="")
    checks: StudyChecksPayload = Field(default_factory=StudyChecksPayload)
    bookmarks: list[StudyBookmarkPayload] = Field(default_factory=list)
    last_view: str = Field(default="sync")


OUTPUT_TYPE_GUIDES = {
    "summary": "핵심 개념을 짧고 빠르게 복습할 수 있는 요약형 대본으로 정리한다.",
    "explain": "수업 내용을 처음 듣는 학생도 이해할 수 있도록 자연스러운 설명형 대본으로 정리한다.",
    "cram": "시험 직전 반복 청취용으로 압축도 높고 리듬감 있는 암기형 대본으로 정리한다.",
    "qa": "질문과 답변이 번갈아 나오는 자기점검형 대본으로 정리한다.",
    "notes": "핵심 개념과 예시를 빠르게 훑는 노트형 대본으로 정리한다.",
}


def get_settings() -> dict[str, str]:
    defaults = {"api_key": "", "audio_dir": "", "default_voice": "", "default_text_model": ""}
    if not SETTINGS_FILE.exists():
        return defaults
    try:
        with SETTINGS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return {**defaults, **data}
    except Exception:
        return defaults


def save_settings(settings: dict[str, str]) -> None:
    with SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


def get_active_audio_dir() -> Path:
    settings = get_settings()
    custom_dir = settings.get("audio_dir", "").strip()
    return Path(custom_dir) if custom_dir else AUDIO_DIR


def get_openai_api_key() -> str:
    settings = get_settings()
    api_key = settings.get("api_key", "").strip() or os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API 키가 설정되어 있지 않습니다.",
        )
    return api_key


def get_text_model() -> str:
    settings = get_settings()
    return (
        settings.get("default_text_model", "").strip()
        or os.getenv("OPENAI_TEXT_MODEL", "").strip()
        or DEFAULT_TEXT_MODEL
    )


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


def cleanup_quick_tts_files(directory: Path, keep: int = 24) -> None:
    if not directory.exists():
        return
    files = sorted(
        directory.glob("*.mp3"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale_file in files[keep:]:
        stale_file.unlink(missing_ok=True)


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


def ensure_simple_data_file() -> None:
    if SIMPLE_DATA_FILE.exists():
        return
    with SIMPLE_DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(DEFAULT_SIMPLE_LIBRARY, file, ensure_ascii=False, indent=2)


def derive_simple_title(title: str, text: str) -> str:
    cleaned_title = re.sub(r"\s+", " ", (title or "").strip())
    if cleaned_title:
        return cleaned_title[:120]

    plain_text = strip_markdown(text or "")
    for line in plain_text.splitlines():
        candidate = re.sub(r"\s+", " ", line).strip(" -#>*\t")
        if candidate:
            return candidate[:120]

    fallback = re.sub(r"\s+", " ", plain_text).strip()
    return (fallback[:120] if fallback else "새 대본")


def get_simple_audio_file(item_id: str) -> Path:
    return get_active_audio_dir() / "_simple" / f"{item_id}.mp3"


def build_simple_item_response(item: dict[str, Any]) -> dict[str, Any]:
    has_audio = bool(item.get("has_audio"))
    audio_version = item.get("audio_updated_at") or item.get("updated_at") or ""
    return {
        "id": item["id"],
        "title": item["title"],
        "text": item["text"],
        "voice": item.get("voice", "alloy"),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
        "audio_updated_at": item.get("audio_updated_at"),
        "has_audio": has_audio,
        "audio_url": f"/api/simple/audio/{item['id']}?v={audio_version}" if has_audio else None,
    }


def build_simple_library_response(library: dict[str, Any]) -> dict[str, Any]:
    items = sorted(
        (build_simple_item_response(item) for item in library.get("items", [])),
        key=lambda item: item.get("updated_at") or "",
        reverse=True,
    )
    default_voice = get_settings().get("default_voice", "").strip().lower()
    return {
        "items": items,
        "default_voice": default_voice if default_voice in VALID_VOICES else "alloy",
    }


def load_simple_library_unlocked() -> dict[str, Any]:
    ensure_simple_data_file()
    try:
        with SIMPLE_DATA_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return json.loads(json.dumps(DEFAULT_SIMPLE_LIBRARY))

    raw_items = data.get("items") if isinstance(data, dict) else []
    if not isinstance(raw_items, list):
        return json.loads(json.dumps(DEFAULT_SIMPLE_LIBRARY))

    normalized_items: list[dict[str, Any]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        item_id = str(raw_item.get("id") or _uuid.uuid4())
        text = raw_item.get("text") if isinstance(raw_item.get("text"), str) else ""
        title = derive_simple_title(str(raw_item.get("title") or ""), text)
        created_at = raw_item.get("created_at") if isinstance(raw_item.get("created_at"), str) else None
        updated_at = raw_item.get("updated_at") if isinstance(raw_item.get("updated_at"), str) else None
        voice = raw_item.get("voice") if isinstance(raw_item.get("voice"), str) else "alloy"
        audio_updated_at = raw_item.get("audio_updated_at") if isinstance(raw_item.get("audio_updated_at"), str) else None
        has_audio = bool(raw_item.get("has_audio"))
        if has_audio and not get_simple_audio_file(item_id).exists():
            has_audio = False
            audio_updated_at = None
        normalized_items.append(
            {
                "id": item_id,
                "title": title,
                "text": text,
                "voice": voice if voice in VALID_VOICES else "alloy",
                "created_at": created_at or updated_at or now_iso(),
                "updated_at": updated_at or created_at or now_iso(),
                "audio_updated_at": audio_updated_at,
                "has_audio": has_audio,
            }
        )

    return {"items": normalized_items}


def save_simple_library_unlocked(data: dict[str, Any]) -> None:
    with SIMPLE_DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def find_simple_item(library: dict[str, Any], item_id: str | None) -> dict[str, Any] | None:
    if not item_id:
        return None
    return next((item for item in library.get("items", []) if item["id"] == item_id), None)


def sync_missing_simple_audio(library: dict[str, Any]) -> bool:
    changed = False
    for item in library.get("items", []):
        if item.get("has_audio") and not get_simple_audio_file(item["id"]).exists():
            item["has_audio"] = False
            item["audio_updated_at"] = None
            changed = True
    return changed


def normalize_output_type(value: str) -> str:
    cleaned = (value or "").strip().lower()
    return cleaned if cleaned in OUTPUT_TYPE_GUIDES else "explain"


def build_professor_profile(payload: ProfessorProfilePayload, profile_id: str | None = None) -> dict[str, Any]:
    return {
        "id": profile_id or str(_uuid.uuid4()),
        "name": normalize_display_name(payload.name, "교수 프로필"),
        "repetition_style": payload.repetition_style.strip(),
        "ppt_reading_ratio": payload.ppt_reading_ratio.strip(),
        "concept_compression_style": payload.concept_compression_style.strip(),
        "difficulty_level": payload.difficulty_level.strip(),
        "extra_rules": payload.extra_rules.strip(),
    }


def build_script_version(
    *,
    label: str,
    output_type: str,
    source: str,
    prompt_text: str,
    text: str,
    voice: str = "alloy",
    audio_path: str | None = None,
    sentences: list[dict[str, Any]] | None = None,
    created_at: str | None = None,
    version_id: str | None = None,
) -> dict[str, Any]:
    safe_source = source if source in {"manual", "external-ai", "legacy"} else "manual"
    return {
        "id": version_id or str(_uuid.uuid4()),
        "label": label.strip() or "새 대본",
        "output_type": normalize_output_type(output_type),
        "source": safe_source,
        "prompt_text": prompt_text.strip(),
        "text": text,
        "voice": validate_voice(voice),
        "audio_path": audio_path,
        "sentences": list(sentences or []),
        "created_at": created_at,
    }


def normalize_study_bookmark_kind(kind: str) -> str:
    normalized = (kind or "").strip().lower()
    return normalized if normalized in {"focus", "hard", "memory"} else "focus"


def normalize_study_view(view: str) -> str:
    normalized = (view or "").strip().lower()
    return normalized if normalized in {"sync", "summary", "focus", "blind"} else "sync"


def build_study_bookmark(
    *,
    label: str,
    text: str,
    start: float,
    end: float,
    kind: str = "focus",
    bookmark_id: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    safe_start = max(0.0, float(start or 0.0))
    safe_end = max(safe_start, float(end or safe_start))
    cleaned_text = re.sub(r"\s+", " ", (text or "").strip())
    fallback_label = cleaned_text[:24] + ("..." if len(cleaned_text) > 24 else "")
    return {
        "id": bookmark_id or str(_uuid.uuid4()),
        "kind": normalize_study_bookmark_kind(kind),
        "label": (label or "").strip() or fallback_label or "학습 포인트",
        "text": cleaned_text,
        "start": safe_start,
        "end": safe_end,
        "created_at": created_at or now_iso(),
    }


def normalize_study_state(study: Any) -> dict[str, Any]:
    if not isinstance(study, dict):
        study = {}

    checks = study.get("checks") if isinstance(study.get("checks"), dict) else {}
    raw_bookmarks = study.get("bookmarks") if isinstance(study.get("bookmarks"), list) else []
    normalized_bookmarks: list[dict[str, Any]] = []
    for bookmark in raw_bookmarks:
        if not isinstance(bookmark, dict):
            continue
        normalized_bookmarks.append(
            build_study_bookmark(
                label=bookmark.get("label", ""),
                text=bookmark.get("text", ""),
                start=bookmark.get("start", 0.0),
                end=bookmark.get("end", bookmark.get("start", 0.0)),
                kind=bookmark.get("kind", "focus"),
                bookmark_id=bookmark.get("id"),
                created_at=bookmark.get("created_at"),
            )
        )

    normalized_bookmarks.sort(key=lambda item: (item.get("start", 0.0), item.get("created_at") or ""))
    return {
        "note": study.get("note", "") or "",
        "recall_note": study.get("recall_note", "") or "",
        "checks": {
            "listen": bool(checks.get("listen", False)),
            "review": bool(checks.get("review", False)),
            "memorize": bool(checks.get("memorize", False)),
        },
        "bookmarks": normalized_bookmarks,
        "last_view": normalize_study_view(study.get("last_view", "sync")),
    }


def normalize_v2_clip(clip: dict[str, Any]) -> dict[str, Any]:
    clip.setdefault("id", str(_uuid.uuid4()))
    clip["title"] = normalize_display_name(clip.get("title", "새 클립"), "클립")
    clip["storage_name"] = normalize_storage_name(clip.get("storage_name", ""), clip["title"])
    clip["type"] = clip.get("type", "lecture")
    clip["voice"] = validate_voice(clip.get("voice", "alloy"))
    clip["audio_path"] = clip.get("audio_path")
    clip["text"] = clip.get("text")
    clip["summary"] = clip.get("summary")
    clip["sentences"] = list(clip.get("sentences") or [])
    clip["derived_from"] = clip.get("derived_from")
    clip["created_at"] = clip.get("created_at")
    clip["transcript_raw"] = clip.get("transcript_raw", "")
    clip["pdf_text"] = clip.get("pdf_text", "")
    clip["notes"] = clip.get("notes", "")
    clip["prompt_profile_id"] = clip.get("prompt_profile_id")
    clip["output_type"] = normalize_output_type(clip.get("output_type", "explain"))
    clip["extra_instructions"] = clip.get("extra_instructions", "")
    clip["prompt_text"] = clip.get("prompt_text", "")
    clip["study"] = normalize_study_state(clip.get("study"))

    normalized_versions: list[dict[str, Any]] = []
    for version in clip.get("script_versions") or []:
        normalized_versions.append(
            build_script_version(
                label=version.get("label", ""),
                output_type=version.get("output_type", clip["output_type"]),
                source=version.get("source", "manual"),
                prompt_text=version.get("prompt_text", clip.get("prompt_text", "")),
                text=version.get("text", ""),
                voice=version.get("voice", clip["voice"]),
                audio_path=version.get("audio_path"),
                sentences=list(version.get("sentences") or []),
                created_at=version.get("created_at"),
                version_id=version.get("id"),
            )
        )

    if not normalized_versions and (clip.get("text") or clip.get("audio_path")):
        normalized_versions.append(
            build_script_version(
                label="기존 대본",
                output_type=clip["output_type"],
                source="legacy",
                prompt_text=clip["prompt_text"],
                text=clip.get("text", "") or "",
                voice=clip["voice"],
                audio_path=clip["audio_path"],
                sentences=clip["sentences"],
                created_at=clip["created_at"],
            )
        )

    clip["script_versions"] = normalized_versions
    active_script_id = clip.get("active_script_id")
    if normalized_versions:
        if not active_script_id or all(v["id"] != active_script_id for v in normalized_versions):
            active_script_id = normalized_versions[-1]["id"]
    else:
        active_script_id = None
    clip["active_script_id"] = active_script_id
    mirror_active_script_to_clip(clip)
    return clip


def mirror_active_script_to_clip(clip: dict[str, Any]) -> None:
    active = find_active_script_version(clip)
    if not active:
        clip["text"] = clip.get("text")
        clip["audio_path"] = clip.get("audio_path")
        clip["sentences"] = list(clip.get("sentences") or [])
        clip["voice"] = validate_voice(clip.get("voice", "alloy"))
        clip["created_at"] = clip.get("created_at")
        return

    clip["text"] = active.get("text")
    clip["audio_path"] = active.get("audio_path")
    clip["sentences"] = list(active.get("sentences") or [])
    clip["voice"] = validate_voice(active.get("voice", clip.get("voice", "alloy")))
    clip["created_at"] = active.get("created_at")
    clip["output_type"] = normalize_output_type(active.get("output_type", clip.get("output_type", "explain")))
    clip["prompt_text"] = active.get("prompt_text", clip.get("prompt_text", ""))


def normalize_v2_library(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        data = {}
    library = {
        "clips": list(data.get("clips") or []),
        "profiles": list(data.get("profiles") or []),
    }

    normalized_profiles: list[dict[str, Any]] = []
    for profile in library["profiles"]:
        try:
            normalized_profiles.append(
                build_professor_profile(
                    ProfessorProfilePayload(
                        name=profile.get("name", "교수 프로필"),
                        repetition_style=profile.get("repetition_style", ""),
                        ppt_reading_ratio=profile.get("ppt_reading_ratio", ""),
                        concept_compression_style=profile.get("concept_compression_style", ""),
                        difficulty_level=profile.get("difficulty_level", ""),
                        extra_rules=profile.get("extra_rules", ""),
                    ),
                    profile_id=profile.get("id"),
                )
            )
        except HTTPException:
            continue
    library["profiles"] = normalized_profiles

    # Migrate legacy hierarchical data to flat list if present
    if "subjects" in data:
        for subject in data["subjects"]:
            if not isinstance(subject, dict):
                continue
            for week in subject.get("weeks") or []:
                if not isinstance(week, dict):
                    continue
                for clip in week.get("clips") or []:
                    if isinstance(clip, dict):
                        library["clips"].append(normalize_v2_clip(clip))
        
    # Ensure all existing clips are properly normalized
    normalized_clips = []
    for clip in library["clips"]:
        if isinstance(clip, dict):
            normalized_clips.append(normalize_v2_clip(clip))
    library["clips"] = normalized_clips

    return library


def find_v2_profile(library: dict[str, Any], profile_id: str) -> dict[str, Any] | None:
    return next((profile for profile in library.get("profiles", []) if profile.get("id") == profile_id), None)


def find_script_version(clip: dict[str, Any], script_version_id: str) -> dict[str, Any] | None:
    return next(
        (version for version in clip.get("script_versions", []) if version.get("id") == script_version_id),
        None,
    )


def find_active_script_version(clip: dict[str, Any]) -> dict[str, Any] | None:
    active_id = clip.get("active_script_id")
    if active_id:
        active = find_script_version(clip, active_id)
        if active:
            return active
    versions = clip.get("script_versions", [])
    return versions[-1] if versions else None


def clear_missing_audio_path(audio_path: str | None) -> str | None:
    if not audio_path:
        return None
    relative_path = re.sub(r"^/?audio/", "", audio_path).replace("/", os.sep)
    file_path = get_active_audio_dir() / relative_path
    return audio_path if file_path.exists() else None


def sync_missing_audio_v2(library: dict[str, Any]) -> bool:
    changed = False
    for subject in library.get("subjects", []):
        for week in subject.get("weeks", []):
            for clip in week.get("clips", []):
                for version in clip.get("script_versions", []):
                    next_audio = clear_missing_audio_path(version.get("audio_path"))
                    if next_audio != version.get("audio_path"):
                        version["audio_path"] = next_audio
                        if next_audio is None:
                            version["sentences"] = []
                        changed = True
                before_audio = clip.get("audio_path")
                mirror_active_script_to_clip(clip)
                if before_audio != clip.get("audio_path"):
                    changed = True
    return changed


def build_output_label(output_type: str, fallback: str = "") -> str:
    normalized = normalize_output_type(output_type)
    if fallback.strip():
        return fallback.strip()
    return {
        "summary": "요약본",
        "explain": "설명본",
        "cram": "암기본",
        "qa": "문답본",
        "notes": "노트본",
    }.get(normalized, "대본")


def build_prompt_text(profile: dict[str, Any] | None, clip: dict[str, Any], output_type: str, extra_instructions: str) -> str:
    transcript = (clip.get("transcript_raw") or "").strip()
    pdf_text = (clip.get("pdf_text") or "").strip()
    notes = (clip.get("notes") or "").strip()
    guide = OUTPUT_TYPE_GUIDES[normalize_output_type(output_type)]
    profile_lines = [
        f"- 반복 설명 성향: {profile.get('repetition_style', '').strip() or '특이사항 없음'}" if profile else "- 반복 설명 성향: 프로필 없음",
        f"- PPT 낭독 비중: {profile.get('ppt_reading_ratio', '').strip() or '특이사항 없음'}" if profile else "- PPT 낭독 비중: 프로필 없음",
        f"- 핵심 개념 압축 방식: {profile.get('concept_compression_style', '').strip() or '특이사항 없음'}" if profile else "- 핵심 개념 압축 방식: 프로필 없음",
        f"- 원하는 설명 난이도: {profile.get('difficulty_level', '').strip() or '특이사항 없음'}" if profile else "- 원하는 설명 난이도: 프로필 없음",
        f"- 추가 규칙: {profile.get('extra_rules', '').strip() or '없음'}" if profile else "- 추가 규칙: 없음",
    ]

    sections = [
        "당신은 대학 강의 내용을 학습용 한국어 TTS 대본으로 재구성하는 편집자다.",
        "목표",
        f"- {guide}",
        "- 결과물은 바로 TTS에 넣을 수 있도록 자연스럽고 매끄러운 한국어 문장으로 작성한다.",
        "- 불필요한 메타 설명, 서론, 사족, '다음과 같이' 같은 안내 문구는 넣지 않는다.",
        "- Markdown 제목이나 표 대신, 실제로 읽어도 자연스러운 문단형 대본을 우선한다.",
        "- 핵심 개념, 교수의 강조 포인트, 시험 포인트가 보이면 우선 반영한다.",
        "",
        "교수 프로필",
        *profile_lines,
        "",
        "사용 자료",
        "[STT 본문]",
        transcript or "(없음)",
        "",
        "[PDF / 슬라이드 텍스트]",
        pdf_text or "(없음)",
        "",
        "[추가 메모]",
        notes or "(없음)",
    ]

    cleaned_extra = extra_instructions.strip()
    if cleaned_extra:
        sections.extend(["", "추가 지시", cleaned_extra])

    sections.extend(
        [
            "",
            "출력 형식",
            "- 한국어로만 작성한다.",
            "- 음성으로 들었을 때 자연스럽게 흐르도록 문장을 다듬는다.",
            "- 기호 남용, 과도한 번호 매기기, 불필요한 마크다운은 피한다.",
            "- 핵심 용어가 처음 나오면 짧게 풀어 설명한다.",
        ]
    )
    return "\n".join(sections).strip()


def request_openai_text(prompt_text: str) -> str:
    headers = {
        "Authorization": f"Bearer {get_openai_api_key()}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": get_text_model(),
        "input": prompt_text,
    }
    try:
        response = requests.post(OPENAI_RESPONSES_URL, headers=headers, json=payload, timeout=180)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI 텍스트 생성 요청에 실패했습니다: {exc}") from exc

    parts: list[str] = []
    for output in data.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                parts.append(content.get("text", ""))
    result = "".join(parts).strip()
    if not result:
        raise HTTPException(status_code=502, detail="OpenAI 응답에서 텍스트를 추출하지 못했습니다.")
    return result


AI_SOURCE_CHUNK_LIMIT = 3400
AI_MERGE_BATCH_SIZE = 3


def build_profile_lines(profile: dict[str, Any] | None) -> list[str]:
    if not profile:
        return [
            "- 반복 설명 성향: 프로필 없음",
            "- PPT 낭독 비중: 프로필 없음",
            "- 핵심 개념 압축 방식: 프로필 없음",
            "- 원하는 설명 난이도: 프로필 없음",
            "- 추가 규칙: 없음",
        ]
    return [
        f"- 반복 설명 성향: {profile.get('repetition_style', '').strip() or '특이사항 없음'}",
        f"- PPT 낭독 비중: {profile.get('ppt_reading_ratio', '').strip() or '특이사항 없음'}",
        f"- 핵심 개념 압축 방식: {profile.get('concept_compression_style', '').strip() or '특이사항 없음'}",
        f"- 원하는 설명 난이도: {profile.get('difficulty_level', '').strip() or '특이사항 없음'}",
        f"- 추가 규칙: {profile.get('extra_rules', '').strip() or '없음'}",
    ]


def build_source_bundle_text(clip: dict[str, Any]) -> str:
    sections: list[str] = []
    transcript = (clip.get("transcript_raw") or "").strip()
    pdf_text = (clip.get("pdf_text") or "").strip()
    notes = (clip.get("notes") or "").strip()
    if transcript:
        sections.append(f"[STT 본문]\n{transcript}")
    if pdf_text:
        sections.append(f"[PDF / 슬라이드 텍스트]\n{pdf_text}")
    if notes:
        sections.append(f"[추가 메모]\n{notes}")
    return "\n\n".join(sections).strip()


def build_prompt_header(profile: dict[str, Any] | None, output_type: str, extra_instructions: str) -> str:
    guide = OUTPUT_TYPE_GUIDES[normalize_output_type(output_type)]
    sections = [
        "당신은 대학 강의 내용을 학습용 한국어 TTS 대본으로 재구성하는 편집자다.",
        "목표",
        f"- {guide}",
        "- 결과물은 바로 TTS에 넣을 수 있도록 자연스럽고 매끄러운 한국어 문장으로 작성한다.",
        "- 불필요한 메타 설명, 장황한 서론, 사족은 넣지 않는다.",
        "- 들었을 때 자연스럽게 이어지도록 문단형 설명문 위주로 작성한다.",
        "- 핵심 개념, 교수의 강조 포인트, 시험 포인트를 우선 반영한다.",
        "",
        "교수 프로필",
        *build_profile_lines(profile),
    ]
    cleaned_extra = extra_instructions.strip()
    if cleaned_extra:
        sections.extend(["", "추가 지시", cleaned_extra])
    sections.extend(
        [
            "",
            "출력 형식",
            "- 한국어로만 작성한다.",
            "- 음성으로 읽었을 때 자연스럽도록 문장을 다듬는다.",
            "- 불필요한 기호, 과한 번호 매기기, 장황한 서론은 피한다.",
            "- 필요한 경우 핵심 용어를 짧게 풀어 설명한다.",
        ]
    )
    return "\n".join(sections).strip()


def build_prompt_text(profile: dict[str, Any] | None, clip: dict[str, Any], output_type: str, extra_instructions: str) -> str:
    source_text = build_source_bundle_text(clip) or "(입력 자료 없음)"
    return "\n\n".join(
        [
            build_prompt_header(profile, output_type, extra_instructions),
            "사용 자료",
            source_text,
        ]
    ).strip()


def build_prompt_chunks(profile: dict[str, Any] | None, clip: dict[str, Any], output_type: str, extra_instructions: str) -> list[str]:
    source_text = build_source_bundle_text(clip)
    if not source_text:
        return [build_prompt_text(profile, clip, output_type, extra_instructions)]
    source_chunks = split_to_chunks(source_text, max_chars=AI_SOURCE_CHUNK_LIMIT)
    if len(source_chunks) <= 1:
        return [build_prompt_text(profile, clip, output_type, extra_instructions)]

    header = build_prompt_header(profile, output_type, extra_instructions)
    prompt_chunks: list[str] = []
    for index, chunk in enumerate(source_chunks):
        prompt_chunks.append(
            "\n\n".join(
                [
                    header,
                    f"입력 자료 조각 {index + 1}/{len(source_chunks)}",
                    "- 이번 조각에 포함된 개념은 빠뜨리지 않는다.",
                    "- 앞뒤 조각과 연결될 수 있도록 문장 흐름을 자연스럽게 유지한다.",
                    "- 이미 다른 조각에서도 나올 법한 설명은 중복을 줄이고 핵심만 남긴다.",
                    "사용 자료",
                    chunk,
                ]
            ).strip()
        )
    return prompt_chunks


def join_prompt_chunks(prompt_chunks: list[str]) -> str:
    if len(prompt_chunks) <= 1:
        return prompt_chunks[0] if prompt_chunks else ""
    return "\n\n".join(
        f"===== PROMPT {index + 1}/{len(prompt_chunks)} =====\n{prompt}"
        for index, prompt in enumerate(prompt_chunks)
    )


def merge_generated_scripts(script_parts: list[str], output_type: str) -> tuple[str, int]:
    if not script_parts:
        raise HTTPException(status_code=500, detail="병합할 대본 조각이 없습니다.")
    if len(script_parts) == 1:
        return script_parts[0], 0

    merge_passes = 0
    current_parts = script_parts[:]
    guide = OUTPUT_TYPE_GUIDES[normalize_output_type(output_type)]
    while len(current_parts) > 1:
        next_round: list[str] = []
        for index in range(0, len(current_parts), AI_MERGE_BATCH_SIZE):
            batch = current_parts[index : index + AI_MERGE_BATCH_SIZE]
            if len(batch) == 1:
                next_round.append(batch[0])
                continue
            merge_prompt = "\n\n".join(
                [
                    "아래 여러 조각 대본을 하나의 자연스러운 최종 학습용 대본으로 합쳐라.",
                    f"- 목표: {guide}",
                    "- 조각 간 중복 설명은 줄이고 흐름은 매끄럽게 정리한다.",
                    "- 핵심 개념, 예시, 시험 포인트는 빠뜨리지 않는다.",
                    "- 최종 결과는 바로 TTS에 넣을 수 있는 자연스러운 한국어 대본이어야 한다.",
                    "",
                    "\n\n".join(f"[조각 {part_index + 1}]\n{part}" for part_index, part in enumerate(batch)),
                ]
            )
            next_round.append(request_openai_text(merge_prompt))
            merge_passes += 1
        current_parts = next_round
    return current_parts[0], merge_passes


def generate_script_from_prompt_chunks(prompt_chunks: list[str], output_type: str) -> tuple[str, dict[str, int]]:
    script_parts = [request_openai_text(prompt_chunk) for prompt_chunk in prompt_chunks]
    merged_text, merge_passes = merge_generated_scripts(script_parts, output_type)
    return merged_text, {
        "source_chunks": len(prompt_chunks),
        "merge_passes": merge_passes,
    }


def resolve_v2_clip(library: dict[str, Any], clip_id: str) -> dict[str, Any]:
    clip = find_v2_clip(library, clip_id)
    if not clip:
        raise HTTPException(status_code=404, detail="클립을 찾을 수 없습니다.")
    return clip


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
            relative_path = re.sub(r'^/?audio/', '', audio_path).replace("/", os.sep)
            file_path = get_active_audio_dir() / relative_path
            if not file_path.exists():
                unit["audio_path"] = None
                changed = True
    return changed


def split_to_chunks(text: str, max_chars: int = 900) -> list[str]:
    """Split text at sentence boundaries so no chunk exceeds max_chars."""
    # Sentence-ending punctuation (Korean + common)
    sentence_end = re.compile(r'(?<=[.!?。…\n])\s*')
    raw_sentences: list[str] = []
    last = 0
    for m in sentence_end.finditer(text):
        end = m.end()
        raw_sentences.append(text[last:end])
        last = end
    if last < len(text):
        raw_sentences.append(text[last:])

    chunks: list[str] = []
    current = ""
    for sentence in raw_sentences:
        # If a single sentence exceeds the limit, split further by spaces
        if len(sentence) > max_chars:
            words = sentence.split(" ")
            for word in words:
                trial = (current + " " + word).lstrip() if current else word
                if len(trial) > max_chars:
                    if current:
                        chunks.append(current.strip())
                    current = word
                else:
                    current = trial
        else:
            trial = current + sentence
            if len(trial) > max_chars:
                if current:
                    chunks.append(current.strip())
                current = sentence
            else:
                current = trial
    if current.strip():
        chunks.append(current.strip())
    return chunks or [text]


def create_speech_chunks(text: str, voice: str, destination: Path) -> list[dict[str, Any]]:
    """Split text into chunks, generate TTS for each, concat MP3 binaries, return sentence timings."""
    chunks = split_to_chunks(text)
    sentences: list[dict[str, Any]] = []

    if len(chunks) == 1:
        create_speech_file(text, voice, destination)
        try:
            audio = MP3(destination)
            duration = audio.info.length
        except Exception:
            duration = 0.0
        sentences.append({
            "text": text,
            "start": 0.0,
            "end": float(duration)
        })
        return sentences

    tmp_parts: list[Path] = [destination.with_suffix(f".part{i}.tmp") for i in range(len(chunks))]
    
    def worker(idx: int, part_chunk: str) -> None:
        create_speech_file(part_chunk, voice, tmp_parts[idx])

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(worker, i, chunk): i for i, chunk in enumerate(chunks)}
        for future in as_completed(futures):
            future.result()

    current_time = 0.0
    try:
        for i, chunk in enumerate(chunks):
            part_path = tmp_parts[i]
            try:
                audio = MP3(part_path)
                duration = audio.info.length
            except Exception:
                duration = 0.0
            sentences.append({
                "text": chunk,
                "start": float(current_time),
                "end": float(current_time + duration)
            })
            current_time += duration

        # Concatenate raw MP3 binary streams
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as out:
            for part in tmp_parts:
                out.write(part.read_bytes())
    finally:
        for part in tmp_parts:
            part.unlink(missing_ok=True)

    return sentences


def create_speech_file(text: str, voice: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_file = destination.with_suffix(".tmp")
    headers = {
        "Authorization": f"Bearer {get_openai_api_key()}",
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
    return frontend_index_response()


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
    dv = payload.default_voice.strip().lower()
    settings = {
        "api_key": payload.api_key.strip(),
        "audio_dir": payload.audio_dir.strip(),
        "default_voice": dv if dv in VALID_VOICES else "",
        "default_text_model": payload.default_text_model.strip(),
    }
    save_settings(settings)
    return settings


@app.post("/api/quick-tts")
def quick_tts(payload: QuickTtsPayload) -> dict[str, Any]:
    raw_text = strip_markdown(payload.text or "")
    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="TTS로 만들 대본을 입력해 주세요.")

    settings = get_settings()
    preferred_voice = (payload.voice or settings.get("default_voice", "") or "alloy").strip().lower()
    voice = validate_voice(preferred_voice if preferred_voice in VALID_VOICES else "alloy")

    quick_dir = get_active_audio_dir() / "_quick"
    quick_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"tts-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{_uuid.uuid4().hex[:8]}.mp3"
    audio_file = quick_dir / storage_name

    sentences = create_speech_chunks(raw_text, voice, audio_file)
    cleanup_quick_tts_files(quick_dir)

    return {
        "audio_url": f"/api/quick-tts/file/{storage_name}",
        "download_name": storage_name,
        "text": raw_text,
        "voice": voice,
        "chunk_count": len(sentences),
        "duration_seconds": float(sentences[-1]["end"]) if sentences else 0.0,
        "created_at": now_iso(),
    }


@app.get("/api/quick-tts/file/{filename}")
def get_quick_tts_file(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.lower().endswith(".mp3"):
        raise HTTPException(status_code=404, detail="오디오 파일을 찾을 수 없습니다.")

    file_path = get_active_audio_dir() / "_quick" / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="오디오 파일을 찾을 수 없습니다.")

    return FileResponse(file_path, media_type="audio/mpeg", filename=safe_name)


@app.get("/api/simple/library")
def get_simple_library() -> dict[str, Any]:
    with data_lock:
        library = load_simple_library_unlocked()
        if sync_missing_simple_audio(library):
            save_simple_library_unlocked(library)
    return build_simple_library_response(library)


@app.post("/api/simple/items")
def save_simple_item(payload: SimpleScriptPayload) -> dict[str, Any]:
    raw_text = payload.text or ""
    if not raw_text.strip() and not payload.title.strip():
        raise HTTPException(status_code=400, detail="제목이나 내용을 입력해 주세요.")

    current_time = now_iso()
    with data_lock:
        library = load_simple_library_unlocked()
        item = find_simple_item(library, payload.item_id)
        if not item:
            item = {
                "id": str(_uuid.uuid4()),
                "title": "",
                "text": "",
                "voice": "alloy",
                "created_at": current_time,
                "updated_at": current_time,
                "audio_updated_at": None,
                "has_audio": False,
            }
            library.setdefault("items", []).append(item)

        text_changed = item.get("text", "") != raw_text
        if text_changed and item.get("has_audio"):
            get_simple_audio_file(item["id"]).unlink(missing_ok=True)
            item["has_audio"] = False
            item["audio_updated_at"] = None

        item["title"] = derive_simple_title(payload.title, raw_text)
        item["text"] = raw_text
        item["updated_at"] = current_time
        save_simple_library_unlocked(library)
        item_response = build_simple_item_response(item)
        library_response = build_simple_library_response(library)

    return {
        **library_response,
        "item": item_response,
    }


@app.post("/api/simple/generate")
def generate_simple_tts(payload: SimpleGeneratePayload) -> dict[str, Any]:
    raw_text = payload.text or ""
    cleaned_text = strip_markdown(raw_text)
    if not cleaned_text.strip():
        raise HTTPException(status_code=400, detail="TTS로 만들 내용을 입력해 주세요.")

    saved_at = now_iso()
    with data_lock:
        library = load_simple_library_unlocked()
        item = find_simple_item(library, payload.item_id)
        if not item:
            item = {
                "id": str(_uuid.uuid4()),
                "title": "",
                "text": "",
                "voice": "alloy",
                "created_at": saved_at,
                "updated_at": saved_at,
                "audio_updated_at": None,
                "has_audio": False,
            }
            library.setdefault("items", []).append(item)

        if item.get("text", "") != raw_text and item.get("has_audio"):
            get_simple_audio_file(item["id"]).unlink(missing_ok=True)
            item["has_audio"] = False
            item["audio_updated_at"] = None

        item["title"] = derive_simple_title(payload.title, raw_text)
        item["text"] = raw_text
        item["updated_at"] = saved_at

        configured_voice = get_settings().get("default_voice", "").strip().lower()
        preferred_voice = (payload.voice or configured_voice or item.get("voice") or "alloy").strip().lower()
        voice = validate_voice(preferred_voice if preferred_voice in VALID_VOICES else "alloy")
        item_id = item["id"]
        save_simple_library_unlocked(library)

    audio_file = get_simple_audio_file(item_id)
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    sentences = create_speech_chunks(cleaned_text, voice, audio_file)
    generated_at = now_iso()

    with data_lock:
        library = load_simple_library_unlocked()
        item = find_simple_item(library, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="대본을 찾을 수 없습니다.")
        item["voice"] = voice
        item["has_audio"] = True
        item["audio_updated_at"] = generated_at
        item["updated_at"] = generated_at
        save_simple_library_unlocked(library)
        item_response = build_simple_item_response(item)
        library_response = build_simple_library_response(library)

    return {
        **library_response,
        "item": item_response,
        "cleaned_text": cleaned_text,
        "chunk_count": len(sentences),
        "duration_seconds": float(sentences[-1]["end"]) if sentences else 0.0,
    }


@app.delete("/api/simple/items/{item_id}")
def delete_simple_item(item_id: str) -> dict[str, Any]:
    with data_lock:
        library = load_simple_library_unlocked()
        item = find_simple_item(library, item_id)
        if not item:
            raise HTTPException(status_code=404, detail="대본을 찾을 수 없습니다.")
        library["items"] = [entry for entry in library.get("items", []) if entry["id"] != item_id]
        get_simple_audio_file(item_id).unlink(missing_ok=True)
        save_simple_library_unlocked(library)
    return build_simple_library_response(library)


@app.get("/api/simple/audio/{item_id}")
def get_simple_audio(item_id: str) -> FileResponse:
    safe_item_id = Path(item_id).name
    if safe_item_id != item_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", safe_item_id):
        raise HTTPException(status_code=404, detail="오디오 파일을 찾을 수 없습니다.")

    file_path = get_simple_audio_file(safe_item_id)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="오디오 파일을 찾을 수 없습니다.")

    return FileResponse(
        file_path,
        media_type="audio/mpeg",
        filename=f"{safe_item_id}.mp3",
        headers={"Cache-Control": "no-store"},
    )


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
    raw_text = payload.text
    voice = validate_voice(payload.voice)

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="변환할 텍스트가 없습니다.")

    with data_lock:
        library = load_library_unlocked()
        subject = get_or_create_subject(library, subject_name)
        unit = get_or_create_unit(subject, unit_name)
        save_library_unlocked(library)
        subject_storage_name = subject["storage_name"]
        unit_storage_name = unit["storage_name"]

    audio_file = get_active_audio_dir() / subject_storage_name / f"{unit_storage_name}.mp3"
    sentences = create_speech_chunks(raw_text, voice, audio_file)
    chunk_count = len(sentences)

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
        "cleaned_text": raw_text,
        "chunk_count": chunk_count,
        "unit": {
            "subject": subject_name,
            "name": unit_name,
            "voice": voice,
            "audio_path": unit["audio_path"],
            "text": unit["text"],
            "created_at": unit["created_at"],
        },
    }

@app.post("/api/v2/generate_summary")
def v2_generate_summary(payload: GenerateSummaryPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        text = (clip.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="요약할 대본 텍스트가 없습니다.")

    summary_text = request_openai_text(f"{payload.prompt.strip()}\n\n[대본]\n{text}")

    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        clip["summary"] = summary_text
        save_v2_library_unlocked(library)

    return {"library": library, "clip": clip}

# ── v2 helpers ────────────────────────────────────────────────────────────────

def load_v2_library_unlocked() -> dict[str, Any]:
    if not DATA_V2_FILE.exists():
        return json.loads(json.dumps(DEFAULT_V2_LIBRARY))
    try:
        with DATA_V2_FILE.open("r", encoding="utf-8") as f:
            return normalize_v2_library(json.load(f))
    except Exception:
        return json.loads(json.dumps(DEFAULT_V2_LIBRARY))


def save_v2_library_unlocked(data: dict[str, Any]) -> None:
    data = normalize_v2_library(data)
    with DATA_V2_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def find_v2_clip(library: dict[str, Any], clip_id: str) -> dict[str, Any] | None:
    return next((c for c in library.get("clips", []) if c["id"] == clip_id), None)


# ── v2 endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/v2/library")
def v2_get_library() -> dict[str, Any]:
    with data_lock:
        library = load_v2_library_unlocked()
        if sync_missing_audio_v2(library):
            save_v2_library_unlocked(library)
    return {"library": library, "voices": list(VALID_VOICES)}


@app.post("/api/profiles")
def create_profile(payload: ProfessorProfilePayload) -> dict[str, Any]:
    profile = build_professor_profile(payload)
    with data_lock:
        library = load_v2_library_unlocked()
        if any(same_name(item["name"], profile["name"]) for item in library.get("profiles", [])):
            raise HTTPException(status_code=409, detail="같은 이름의 교수 프로필이 이미 있습니다.")
        library.setdefault("profiles", []).append(profile)
        save_v2_library_unlocked(library)
    return {"library": library, "profile": profile}


@app.patch("/api/profiles")
def update_profile(payload: UpdateProfessorProfilePayload) -> dict[str, Any]:
    with data_lock:
        library = load_v2_library_unlocked()
        profile = find_v2_profile(library, payload.id)
        if not profile:
            raise HTTPException(status_code=404, detail="교수 프로필을 찾을 수 없습니다.")
        next_profile = build_professor_profile(payload, profile_id=payload.id)
        if any(
            other["id"] != payload.id and same_name(other["name"], next_profile["name"])
            for other in library.get("profiles", [])
        ):
            raise HTTPException(status_code=409, detail="같은 이름의 교수 프로필이 이미 있습니다.")
        profile.update(next_profile)
        save_v2_library_unlocked(library)
    return {"library": library, "profile": profile}


@app.delete("/api/profiles")
def delete_profile(id: str = Query(..., min_length=1)) -> dict[str, Any]:
    with data_lock:
        library = load_v2_library_unlocked()
        if not find_v2_profile(library, id):
            raise HTTPException(status_code=404, detail="교수 프로필을 찾을 수 없습니다.")
        library["profiles"] = [profile for profile in library.get("profiles", []) if profile["id"] != id]
        for clip in library.get("clips", []):
            if clip.get("prompt_profile_id") == id:
                clip["prompt_profile_id"] = None
        save_v2_library_unlocked(library)
    return {"library": library}


@app.post("/api/clips")
def create_clip(payload: ClipCreatePayload) -> dict[str, Any]:
    clip_title = normalize_display_name(payload.title, "클립")
    default_voice = get_settings().get("default_voice", "").strip().lower()
    initial_voice = default_voice if default_voice in VALID_VOICES else "alloy"

    with data_lock:
        library = load_v2_library_unlocked()

        clip: dict[str, Any] = {
            "id": str(_uuid.uuid4()),
            "title": clip_title,
            "storage_name": normalize_storage_name(clip_title, "clip"),
            "type": payload.clip_type,
            "voice": initial_voice,
            "audio_path": None,
            "text": None,
            "summary": None,
            "sentences": [],
            "derived_from": None,
            "created_at": None,
            "transcript_raw": "",
            "pdf_text": "",
            "notes": "",
            "prompt_profile_id": None,
            "output_type": "explain",
            "extra_instructions": "",
            "prompt_text": "",
            "script_versions": [],
            "active_script_id": None,
            "study": normalize_study_state(None),
        }
        library["clips"].append(clip)
        save_v2_library_unlocked(library)

    return {"library": library, "clip": clip}


@app.delete("/api/clips")
def delete_clip(clip_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    with data_lock:
        library = load_v2_library_unlocked()
        clip = find_v2_clip(library, clip_id)
        if not clip:
            raise HTTPException(status_code=404, detail="클립을 찾을 수 없습니다.")

        audio_paths = {clip.get("audio_path")}
        audio_paths.update(version.get("audio_path") for version in clip.get("script_versions", []))
        for audio_path in audio_paths:
            if not audio_path:
                continue
            rel = re.sub(r'^/?audio/', '', audio_path).replace("/", os.sep)
            (get_active_audio_dir() / rel).unlink(missing_ok=True)

        library["clips"] = [c for c in library["clips"] if c["id"] != clip_id]
        save_v2_library_unlocked(library)

    return {"library": library}


@app.patch("/api/clips/source")
def update_clip_source(payload: ClipSourcePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        if payload.prompt_profile_id and not find_v2_profile(library, payload.prompt_profile_id):
            raise HTTPException(status_code=404, detail="교수 프로필을 찾을 수 없습니다.")
        clip["transcript_raw"] = payload.transcript_raw
        clip["pdf_text"] = payload.pdf_text
        clip["notes"] = payload.notes
        clip["prompt_profile_id"] = payload.prompt_profile_id
        clip["output_type"] = normalize_output_type(payload.output_type)
        clip["extra_instructions"] = payload.extra_instructions
        save_v2_library_unlocked(library)
    return {"library": library, "clip": clip}


@app.patch("/api/clips/study")
def update_clip_study(payload: StudyStatePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        clip["study"] = normalize_study_state(
            {
                "note": payload.note,
                "recall_note": payload.recall_note,
                "checks": payload.checks.model_dump(),
                "bookmarks": [bookmark.model_dump() for bookmark in payload.bookmarks],
                "last_view": payload.last_view,
            }
        )
        save_v2_library_unlocked(library)
    return {"library": library, "clip": clip}


@app.post("/api/v2/compose_prompt")
def compose_prompt(payload: ComposePromptPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        if payload.prompt_profile_id and not find_v2_profile(library, payload.prompt_profile_id):
            raise HTTPException(status_code=404, detail="교수 프로필을 찾을 수 없습니다.")
        clip["transcript_raw"] = payload.transcript_raw
        clip["pdf_text"] = payload.pdf_text
        clip["notes"] = payload.notes
        clip["prompt_profile_id"] = payload.prompt_profile_id
        clip["output_type"] = normalize_output_type(payload.output_type)
        clip["extra_instructions"] = payload.extra_instructions
        profile = find_v2_profile(library, clip["prompt_profile_id"]) if clip.get("prompt_profile_id") else None
        prompt_chunks = build_prompt_chunks(profile, clip, clip["output_type"], clip["extra_instructions"])
        clip["prompt_text"] = join_prompt_chunks(prompt_chunks)
        save_v2_library_unlocked(library)
    return {
        "library": library,
        "clip": clip,
        "prompt_text": clip["prompt_text"],
        "prompt_chunks": prompt_chunks,
    }


@app.post("/api/v2/generate_script")
def generate_script(payload: GenerateScriptPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        if payload.prompt_profile_id and not find_v2_profile(library, payload.prompt_profile_id):
            raise HTTPException(status_code=404, detail="교수 프로필을 찾을 수 없습니다.")
        clip["transcript_raw"] = payload.transcript_raw
        clip["pdf_text"] = payload.pdf_text
        clip["notes"] = payload.notes
        clip["prompt_profile_id"] = payload.prompt_profile_id
        clip["output_type"] = normalize_output_type(payload.output_type)
        clip["extra_instructions"] = payload.extra_instructions
        profile = find_v2_profile(library, clip["prompt_profile_id"]) if clip.get("prompt_profile_id") else None
        prompt_chunks = build_prompt_chunks(profile, clip, clip["output_type"], clip["extra_instructions"])
        prompt_text = join_prompt_chunks(prompt_chunks)
        clip["prompt_text"] = prompt_text
        save_v2_library_unlocked(library)

    generated_text, processing = generate_script_from_prompt_chunks(prompt_chunks, payload.output_type)

    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        version = build_script_version(
            label=build_output_label(clip["output_type"], payload.label),
            output_type=clip["output_type"],
            source="external-ai",
            prompt_text=prompt_text,
            text=generated_text,
            voice=clip.get("voice", "alloy"),
            created_at=now_iso(),
        )
        clip.setdefault("script_versions", []).append(version)
        clip["active_script_id"] = version["id"]
        mirror_active_script_to_clip(clip)
        save_v2_library_unlocked(library)
    return {
        "library": library,
        "clip": clip,
        "script_version": version,
        "prompt_text": prompt_text,
        "prompt_chunks": prompt_chunks,
        "processing": processing,
    }


@app.post("/api/clips/script_versions")
def save_script_version(payload: SaveScriptVersionPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        version = build_script_version(
            label=build_output_label(payload.output_type, payload.label),
            output_type=payload.output_type,
            source=payload.source,
            prompt_text=payload.prompt_text,
            text=payload.text.strip(),
            voice=clip.get("voice", "alloy"),
            created_at=now_iso(),
        )
        clip.setdefault("script_versions", []).append(version)
        clip["active_script_id"] = version["id"]
        clip["output_type"] = version["output_type"]
        if payload.prompt_text.strip():
            clip["prompt_text"] = payload.prompt_text.strip()
        mirror_active_script_to_clip(clip)
        save_v2_library_unlocked(library)
    return {"library": library, "clip": clip, "script_version": version}


@app.patch("/api/clips/script_versions/select")
def select_script_version(payload: SelectScriptVersionPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        version = find_script_version(clip, payload.script_version_id)
        if not version:
            raise HTTPException(status_code=404, detail="대본 버전을 찾을 수 없습니다.")
        clip["active_script_id"] = version["id"]
        mirror_active_script_to_clip(clip)
        save_v2_library_unlocked(library)
    return {"library": library, "clip": clip, "script_version": version}


@app.post("/api/v2/generate")
def v2_generate_tts(payload: V2GeneratePayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")
    voice = validate_voice(payload.voice)

    with data_lock:
        library = load_v2_library_unlocked()
        subj, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        subject_storage = subj["storage_name"]
        clip_storage = clip["storage_name"]
        target_version_id = payload.script_version_id or clip.get("active_script_id")
        target_version = find_script_version(clip, target_version_id) if target_version_id else None
        raw_text = (
            (payload.text or "").strip()
            or (target_version.get("text", "").strip() if target_version else "")
            or (clip.get("text") or "").strip()
        )
        if not raw_text:
            raise HTTPException(status_code=400, detail="변환할 텍스트가 없습니다.")

    audio_stem = f"{clip_storage}-{target_version['id'][:8]}" if target_version else clip_storage
    audio_file = get_active_audio_dir() / subject_storage / f"{audio_stem}.mp3"
    sentences = create_speech_chunks(raw_text, voice, audio_file)
    chunk_count = len(sentences)
    audio_path = f"/audio/{subject_storage}/{audio_stem}.mp3"
    created_at = now_iso()

    with data_lock:
        library = load_v2_library_unlocked()
        _, _, clip = resolve_v2_clip(library, subject_name, payload.week_id, payload.clip_id)
        target_version = find_script_version(clip, target_version_id) if target_version_id else None
        if target_version:
            target_version["text"] = raw_text
            target_version["voice"] = voice
            target_version["audio_path"] = audio_path
            target_version["sentences"] = sentences
            target_version["created_at"] = created_at
            clip["active_script_id"] = target_version["id"]
        clip["voice"] = voice
        clip["audio_path"] = audio_path
        clip["text"] = raw_text
        clip["sentences"] = sentences
        clip["created_at"] = created_at
        mirror_active_script_to_clip(clip)
        save_v2_library_unlocked(library)

    return {
        "library": library,
        "cleaned_text": raw_text,
        "chunk_count": chunk_count,
        "clip": clip,
    }


class ReorderClipsPayload(BaseModel):
    subject: str = Field(..., min_length=1, max_length=120)
    week_id: str = Field(..., min_length=1)
    clip_ids: list[str]


@app.patch("/api/weeks/reorder_clips")
def reorder_clips(payload: ReorderClipsPayload) -> dict[str, Any]:
    subject_name = normalize_display_name(payload.subject, "과목")

    with data_lock:
        library = load_v2_library_unlocked()
        subj = find_v2_subject(library, subject_name)
        if not subj:
            raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
        week = find_v2_week(subj, payload.week_id)
        if not week:
            raise HTTPException(status_code=404, detail="주차를 찾을 수 없습니다.")

        # Validate clip_ids
        current_ids = {c["id"] for c in week["clips"]}
        payload_ids = set(payload.clip_ids)
        if current_ids != payload_ids:
            raise HTTPException(status_code=400, detail="제공된 클립 ID 목록이 현재 주차의 클립들과 일치하지 않습니다.")

        clip_map = {c["id"]: c for c in week["clips"]}
        week["clips"] = [clip_map[cid] for cid in payload.clip_ids]

        save_v2_library_unlocked(library)

    return {"library": library}


class PreviewVoicePayload(BaseModel):
    voice: str
    text: str = "안녕하세요, 저는 이 목소리의 주인공입니다."

@app.post("/api/settings/preview-voice")
def preview_voice(payload: PreviewVoicePayload):
    voice = validate_voice(payload.voice)
    text = payload.text
    
    settings = get_settings()
    api_key = get_openai_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="API 키가 설정되지 않았습니다.")

    url = OPENAI_SPEECH_URL
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": "tts-1",
        "voice": voice,
        "input": text,
        "response_format": "mp3"
    }

    try:
        response = requests.post(url, headers=headers, json=data, timeout=60)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"OpenAI TTS API 호출 실패: {str(e)}")

    return Response(content=response.content, media_type="audio/mpeg")


@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> FileResponse:
    if full_path.startswith(("api/", "audio/", "static/", "v2/")):
        raise HTTPException(status_code=404, detail="Not found")
    if "." in Path(full_path).name:
        raise HTTPException(status_code=404, detail="Not found")
    return frontend_index_response()
