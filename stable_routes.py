from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import DATA_DIR, get_text_model, request_openai_text

router = APIRouter(prefix="/api/stable", tags=["stable-workflow"])

PROMPT_VERSION = "structured-lecture-v1.0"
META_FILE = Path(DATA_DIR) / "lecture_meta.json"
_meta_lock = threading.RLock()


class ComposePayload(BaseModel):
    recipe: Literal["stt-fix", "lecture", "audit"] = "lecture"
    title: str = Field(default="", max_length=300)
    source: str = Field(default="", max_length=600_000)
    script: str = Field(default="", max_length=600_000)
    context_note: str = Field(default="", max_length=20_000)


class GeneratePayload(ComposePayload):
    recipe: Literal["lecture"] = "lecture"


class MetaPatch(BaseModel):
    collection: str | None = Field(default=None, max_length=120)
    subject: str | None = Field(default=None, max_length=120)
    source_text: str | None = Field(default=None, max_length=600_000)
    clean_text: str | None = Field(default=None, max_length=600_000)
    context_note: str | None = Field(default=None, max_length=20_000)
    favorite: bool | None = None
    last_position: float | None = Field(default=None, ge=0)
    prompt_version: str | None = Field(default=None, max_length=120)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_meta_unlocked() -> dict:
    if not META_FILE.exists():
        return {"items": {}}
    try:
        data = json.loads(META_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"items": {}}
    if not isinstance(data, dict):
        return {"items": {}}
    if not isinstance(data.get("items"), dict):
        data["items"] = {}
    return data


def _write_meta_unlocked(data: dict) -> None:
    META_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = META_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(META_FILE)


def _clean(value: str) -> str:
    return value.strip()


def _source_block(source: str) -> str:
    return f"""[원본 자료 시작]\n{source.strip()}\n[원본 자료 끝]"""


def build_prompt(payload: ComposePayload) -> str:
    source = _clean(payload.source)
    script = _clean(payload.script)
    context_note = _clean(payload.context_note)
    title = _clean(payload.title) or "제목 없음"

    if payload.recipe in {"stt-fix", "lecture"} and not source:
        raise HTTPException(status_code=400, detail="원본 자료가 비어 있습니다.")
    if payload.recipe == "audit" and (not source or not script):
        raise HTTPException(status_code=400, detail="누락 검수에는 원본 자료와 완성 대본이 모두 필요합니다.")

    if payload.recipe == "stt-fix":
        return f"""너는 대학 강의·기술 강의 STT 전사본의 오류 보정자다.

목표:
아래 전사본의 내용, 순서, 발화 흐름을 유지하면서 STT가 잘못 인식한 부분만 원래 의미에 가깝게 보정한다.

반드시 지킬 원칙:
1. 요약, 재구성, 설명 추가, 문체 개선을 하지 않는다.
2. 문맥상 STT 오류라고 판단할 근거가 충분한 부분만 수정한다.
3. 전공 전문용어, 영어 용어와 약어, 사람명·기관명·제품명·기술명, 수식·숫자·단위를 특히 확인한다.
4. 주변 문맥과 맞지 않는 유사 발음 단어는 명확할 때만 바로잡는다.
5. 불확실한 내용은 추측해서 채우지 말고 원문을 유지한다.
6. 원문에 없는 문장이나 빠진 내용을 새로 만들어 넣지 않는다.
7. 타임스탬프가 있다면 그대로 유지한다.
8. 출력은 보정된 전사본 본문만 제공한다. 수정 내역, 요약, 해설은 붙이지 않는다.

강의 제목:
{title}

{_source_block(source)}"""

    if payload.recipe == "audit":
        return f"""너는 학습용 강의 대본의 '내용 누락 검수자'다.

목표:
원본 자료와 완성 대본을 비교해서, 원본에 실제로 존재하지만 완성 대본에서 빠졌거나 의미가 약화된 설명만 찾아낸다.

검수 원칙:
1. 문체 차이나 표현 차이는 문제로 보지 않는다.
2. 원본에 없는 지식을 새로 요구하지 않는다.
3. 사소한 반복은 누락으로 보지 않되, 반복 속에 새로운 정보가 있으면 확인한다.
4. 정의, 이유, 예시, 조건, 예외, 비교, 인과관계, 강사가 강조한 포인트가 빠졌는지 본다.
5. 확실한 누락과 의심되는 누락을 구분한다.
6. 마지막에 '누락 없음 / 보완 필요' 중 하나로 판정한다.
7. 대본을 다시 작성하지 말고 검수 결과만 제공한다.

강의 제목:
{title}

[원본 자료]
{source}

[완성 대본]
{script}
"""

    note_section = f"""\n[사용자 추가 맥락]\n{context_note}\n""" if context_note else ""

    return f"""너는 학습용 구두 강의 대본을 설계하는 전문 설명자다.
이 요청의 목적은 원본을 짧게 요약하는 것이 아니라, 원본의 설명 범위를 최대한 보존하면서 '듣기만 해도 흐름이 잡히는 강의 대본'으로 재구성하는 것이다.

이 대본의 고정 설명 원칙:
1. 큰 그림 먼저:
   - 세부 용어를 바로 던지지 말고, 먼저 이번 내용이 전체 구조에서 어디에 있는지 짧게 보여준다.
2. Why before What:
   - 새 개념은 가능한 경우 정의부터 외우게 하지 말고, 왜 필요한지·어떤 문제 때문에 등장하는지부터 설명한다.
3. Problem → Concept:
   - 다음 개념을 목차처럼 나열하지 말고, 앞 개념에서 자연스럽게 생기는 질문이나 문제를 통해 도출한다.
4. 추상 ↔ 구체:
   - 추상적인 정의에는 이해에 실제로 도움이 되는 구체적인 예시나 상황을 붙인다.
5. 인과적 연결:
   - 각 절 사이가 끊기지 않게 '그렇다면', '그런데', '여기서' 등의 논리적 연결을 사용한다.
6. 회상 호출:
   - 뒤에서 필요한 선행 개념이 나오면 '앞에서 봤던 ...'처럼 짧게 다시 작업기억에 올려준다.
7. 위치 안내:
   - 긴 설명에서는 중간중간 지금까지 무엇을 봤고 이제 무엇으로 넘어가는지 알려준다.
8. 중요도 안내:
   - 모든 정보를 같은 무게로 말하지 말고, 핵심·보조 설명·세부사항을 구별해 준다.
9. 의미 있는 반복:
   - 핵심은 필요하면 다른 표현으로 한 번 더 설명하되, 같은 문장을 기계적으로 반복하지 않는다.
10. 원본 범위 보존:
   - 원본에 실제로 있는 설명, 예시, 조건, 비교, 이유를 편의상 요약해서 삭제하지 않는다.
   - 통일성을 조금 해치더라도 학습에 필요한 원본 설명을 우선 보존한다.
11. 과도한 창작 금지:
   - 원본에 없는 사실을 확신해서 추가하지 않는다. 보충 설명이 꼭 필요하면 일반적이고 검증 가능한 수준의 연결 설명만 최소한으로 사용한다.
12. TTS 친화성:
   - 문장은 너무 길게 늘이지 않는다.
   - 괄호와 기호를 과하게 사용하지 않는다.
   - 소리 내어 읽었을 때 자연스러운 구어체로 쓴다.
   - 제목·소제목은 사용할 수 있지만, 표나 복잡한 목록보다 실제로 말할 수 있는 문장 중심으로 작성한다.
13. 특정 강사의 고유한 말버릇이나 문구를 흉내 내지 않는다.
   - 대신 큰 그림, 질문을 통한 전개, 예시, 인과 연결, 회상, 중요도 안내 같은 설명 설계 원리만 적용한다.

출력 조건:
- 결과는 완성된 강의 대본 본문만 제공한다.
- '다음은 대본입니다' 같은 메타 설명은 붙이지 않는다.
- 원본이 충분히 길다면 결과도 충분히 길어야 한다. 임의로 압축하지 않는다.
- 원본에 불확실하거나 끊긴 부분이 있으면 사실을 만들어 메우지 않는다.
- 전문용어는 정확한 표기를 유지하되, TTS로 읽기 매우 어려운 표기는 문맥상 자연스럽게 읽히도록 문장 안에서 풀어 설명할 수 있다.

강의 제목:
{title}
{note_section}
{_source_block(source)}
"""


@router.get("/info")
def stable_info() -> dict:
    return {
        "prompt_version": PROMPT_VERSION,
        "text_model": get_text_model(),
        "recipes": ["stt-fix", "lecture", "audit"],
    }


@router.post("/compose")
def compose_prompt(payload: ComposePayload) -> dict:
    return {
        "prompt": build_prompt(payload),
        "prompt_version": PROMPT_VERSION,
        "text_model": get_text_model(),
    }


@router.post("/generate")
def generate_script(payload: GeneratePayload) -> dict:
    prompt = build_prompt(payload)
    text = request_openai_text(prompt)
    return {
        "text": text,
        "prompt": prompt,
        "prompt_version": PROMPT_VERSION,
        "text_model": get_text_model(),
    }


@router.get("/meta")
def get_meta() -> dict:
    with _meta_lock:
        data = _read_meta_unlocked()
    return {
        "items": data.get("items", {}),
        "prompt_version": PROMPT_VERSION,
        "text_model": get_text_model(),
    }


@router.patch("/meta/{item_id}")
def patch_meta(item_id: str, payload: MetaPatch) -> dict:
    safe_id = item_id.strip()
    if not safe_id:
        raise HTTPException(status_code=400, detail="item_id가 필요합니다.")

    with _meta_lock:
        data = _read_meta_unlocked()
        items = data.setdefault("items", {})
        current = items.get(safe_id, {})
        if not isinstance(current, dict):
            current = {}

        patch = payload.model_dump(exclude_unset=True)
        for key in ("collection", "subject", "source_text", "clean_text", "context_note", "prompt_version"):
            if key in patch and isinstance(patch[key], str):
                patch[key] = patch[key].strip()

        current.update(patch)
        current["updated_at"] = _now()
        items[safe_id] = current
        _write_meta_unlocked(data)

    return {"item_id": safe_id, "meta": current}


@router.delete("/meta/{item_id}")
def delete_meta(item_id: str) -> dict:
    with _meta_lock:
        data = _read_meta_unlocked()
        removed = data.setdefault("items", {}).pop(item_id, None)
        _write_meta_unlocked(data)
    return {"item_id": item_id, "removed": bool(removed)}
