from __future__ import annotations

import sqlite3
import os
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = Path(os.environ.get("MEETING_DB_PATH", DATA_DIR / "meetings.db"))


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                theme TEXT DEFAULT '',
                date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                location TEXT NOT NULL,
                level TEXT NOT NULL,
                format TEXT NOT NULL,
                academic_field TEXT NOT NULL,
                meeting_type TEXT NOT NULL,
                goal TEXT NOT NULL,
                audience TEXT NOT NULL,
                attendee_count INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                planning_notes TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS agenda_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                section_name TEXT NOT NULL,
                session_format TEXT NOT NULL,
                topic TEXT NOT NULL,
                host TEXT DEFAULT '',
                speaker TEXT DEFAULT '',
                panelists TEXT DEFAULT '',
                discussion_topic TEXT DEFAULT '',
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                location TEXT NOT NULL,
                execution_notes TEXT DEFAULT '',
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS speaker_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                agenda_item_id INTEGER,
                expert_name TEXT NOT NULL,
                role TEXT NOT NULL,
                task_description TEXT NOT NULL,
                time_range TEXT NOT NULL,
                notes TEXT DEFAULT '',
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY (agenda_item_id) REFERENCES agenda_items(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS validation_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                severity TEXT NOT NULL,
                rule_code TEXT NOT NULL,
                message TEXT NOT NULL,
                agenda_item_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY (agenda_item_id) REFERENCES agenda_items(id) ON DELETE CASCADE
            );
            """
        )
