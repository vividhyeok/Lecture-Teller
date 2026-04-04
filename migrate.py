"""
migrate.py — LectureTeller v1 → v2 데이터 마이그레이션

실행: python migrate.py
결과: data_v2.json 생성

변환 내용:
  [v1] subjects[].units[]
  [v2] subjects[].weeks[{id, name, clips[{id, ...}]}]

기존 data.json은 유지됩니다.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
OLD_FILE = BASE_DIR / "data.json"
NEW_FILE = BASE_DIR / "data_v2.json"


def migrate() -> None:
    if not OLD_FILE.exists():
        print(f"❌ {OLD_FILE} 파일을 찾을 수 없습니다.")
        return

    with OLD_FILE.open("r", encoding="utf-8") as f:
        old = json.load(f)

    new: dict = {"subjects": []}

    for subj in old.get("subjects", []):
        clips = []
        for unit in subj.get("units", []):
            clips.append({
                "id": str(uuid.uuid4()),
                "title": unit["name"],
                "storage_name": unit["storage_name"],
                "type": "lecture",
                "voice": unit.get("voice", "alloy"),
                "audio_path": unit.get("audio_path"),
                "text": unit.get("text"),
                "sentences": [],   # Phase 5에서 채워질 LRC 데이터
                "derived_from": None,
                "created_at": unit.get("created_at"),
            })

        weeks = []
        if clips:
            weeks.append({
                "id": str(uuid.uuid4()),
                "name": "기본",
                "description": "",
                "tags": [],
                "clips": clips,
            })

        new["subjects"].append({
            "name": subj["name"],
            "storage_name": subj["storage_name"],
            "weeks": weeks,
        })

    with NEW_FILE.open("w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=2)

    total_clips = sum(
        len(w["clips"])
        for s in new["subjects"]
        for w in s["weeks"]
    )
    print(f"✅ 마이그레이션 완료: {OLD_FILE.name} → {NEW_FILE.name}")
    print(f"   과목 {len(new['subjects'])}개 / 클립 {total_clips}개 변환됨")
    print(f"   각 과목의 기존 단원들은 '기본' 주차 안에 묶었습니다.")
    print(f"   React UI에서 주차를 재편성하세요.")


if __name__ == "__main__":
    migrate()
