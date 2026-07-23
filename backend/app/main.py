from __future__ import annotations

import sqlite3
from urllib.parse import quote
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.db import get_connection, init_db, row_to_dict
from app.schemas import AgendaItemCreate, AgendaItemUpdate, MeetingCreate, MeetingUpdate, RecalculateRequest, ReorderRequest
from app.services.excel_export import build_excel
from app.services.planner import generate_plan
from app.services.time_utils import add_minutes
from app.services.validation import validate_meeting

app = FastAPI(title="学术会议内容策划小助手 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meetings")
def list_meetings() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM meetings ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/meetings")
def create_meeting(payload: MeetingCreate) -> dict:
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO meetings
            (name, date, start_time, end_time, location, level, format, academic_field, meeting_type, goal, audience, attendee_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.date,
                payload.start_time,
                payload.end_time,
                payload.location,
                payload.level,
                payload.format,
                payload.academic_field,
                payload.meeting_type,
                payload.goal,
                payload.audience,
                payload.attendee_count,
            ),
        )
        meeting_id = cur.lastrowid
    return get_meeting(meeting_id)


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: int) -> dict:
    meeting = fetch_meeting(meeting_id)
    agenda_items = fetch_agenda_items(meeting_id)
    speaker_tasks = fetch_speaker_tasks(meeting_id)
    validations = fetch_validations(meeting_id)
    return {**meeting, "agenda_items": agenda_items, "speaker_tasks": speaker_tasks, "validation_results": validations}


@app.put("/api/meetings/{meeting_id}")
def update_meeting(meeting_id: int, payload: MeetingUpdate) -> dict:
    fetch_meeting(meeting_id)
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE meetings
            SET name=?, theme=?, date=?, start_time=?, end_time=?, location=?, level=?, format=?,
                academic_field=?, meeting_type=?, goal=?, audience=?, attendee_count=?,
                status=?, planning_notes=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (
                payload.name,
                payload.theme,
                payload.date,
                payload.start_time,
                payload.end_time,
                payload.location,
                payload.level,
                payload.format,
                payload.academic_field,
                payload.meeting_type,
                payload.goal,
                payload.audience,
                payload.attendee_count,
                payload.status,
                payload.planning_notes,
                meeting_id,
            ),
        )
    return get_meeting(meeting_id)


@app.delete("/api/meetings/{meeting_id}")
def delete_meeting(meeting_id: int) -> dict:
    fetch_meeting(meeting_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM meetings WHERE id=?", (meeting_id,))
    return {"deleted": True}


@app.post("/api/meetings/{meeting_id}/generate")
def generate_meeting(meeting_id: int) -> dict:
    meeting = fetch_meeting(meeting_id)
    plan = generate_plan(meeting)
    with get_connection() as conn:
        conn.execute("DELETE FROM agenda_items WHERE meeting_id=?", (meeting_id,))
        conn.execute("DELETE FROM speaker_tasks WHERE meeting_id=?", (meeting_id,))
        conn.execute(
            "UPDATE meetings SET theme=?, planning_notes=?, status='generated', updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (plan["theme"], plan["planning_notes"], meeting_id),
        )
        agenda_id_by_order = {}
        for item in plan["agenda_items"]:
            cur = conn.execute(
                """
                INSERT INTO agenda_items
                (meeting_id, sort_order, section_name, session_format, topic, host, speaker, panelists,
                 discussion_topic, start_time, end_time, duration_minutes, location, execution_notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    meeting_id,
                    item["sort_order"],
                    item["section_name"],
                    item["session_format"],
                    item["topic"],
                    item["host"],
                    item["speaker"],
                    item["panelists"],
                    item["discussion_topic"],
                    item["start_time"],
                    item["end_time"],
                    item["duration_minutes"],
                    item["location"],
                    item["execution_notes"],
                ),
            )
            agenda_id_by_order[item["sort_order"]] = cur.lastrowid
        for task in plan["speaker_tasks"]:
            conn.execute(
                """
                INSERT INTO speaker_tasks (meeting_id, agenda_item_id, expert_name, role, task_description, time_range, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (meeting_id, None, task["expert_name"], task["role"], task["task_description"], task["time_range"], task["notes"]),
            )
    return get_meeting(meeting_id)


@app.post("/api/meetings/{meeting_id}/agenda-items")
def create_agenda_item(meeting_id: int, payload: AgendaItemCreate) -> dict:
    fetch_meeting(meeting_id)
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO agenda_items
            (meeting_id, sort_order, section_name, session_format, topic, host, speaker, panelists,
             discussion_topic, start_time, end_time, duration_minutes, location, execution_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meeting_id,
                payload.sort_order,
                payload.section_name,
                payload.session_format,
                payload.topic,
                payload.host,
                payload.speaker,
                payload.panelists,
                payload.discussion_topic,
                payload.start_time,
                payload.end_time,
                payload.duration_minutes,
                payload.location,
                payload.execution_notes,
            ),
        )
    return fetch_agenda_item(cur.lastrowid)


@app.put("/api/agenda-items/{item_id}")
def update_agenda_item(item_id: int, payload: AgendaItemUpdate) -> dict:
    fetch_agenda_item(item_id)
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE agenda_items
            SET sort_order=?, section_name=?, session_format=?, topic=?, host=?, speaker=?, panelists=?,
                discussion_topic=?, start_time=?, end_time=?, duration_minutes=?, location=?, execution_notes=?
            WHERE id=?
            """,
            (
                payload.sort_order,
                payload.section_name,
                payload.session_format,
                payload.topic,
                payload.host,
                payload.speaker,
                payload.panelists,
                payload.discussion_topic,
                payload.start_time,
                payload.end_time,
                payload.duration_minutes,
                payload.location,
                payload.execution_notes,
                item_id,
            ),
        )
    return fetch_agenda_item(item_id)


@app.delete("/api/agenda-items/{item_id}")
def delete_agenda_item(item_id: int) -> dict:
    item = fetch_agenda_item(item_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM agenda_items WHERE id=?", (item_id,))
    return {"deleted": True, "meeting_id": item["meeting_id"]}


@app.post("/api/meetings/{meeting_id}/agenda-items/reorder")
def reorder_agenda_items(meeting_id: int, payload: ReorderRequest) -> dict:
    fetch_meeting(meeting_id)
    with get_connection() as conn:
        for order, item_id in enumerate(payload.item_ids, start=1):
            conn.execute("UPDATE agenda_items SET sort_order=? WHERE id=? AND meeting_id=?", (order, item_id, meeting_id))
    return get_meeting(meeting_id)


@app.post("/api/meetings/{meeting_id}/agenda-items/recalculate-time")
def recalculate_time(meeting_id: int, payload: RecalculateRequest) -> dict:
    meeting = fetch_meeting(meeting_id)
    items = fetch_agenda_items(meeting_id)
    cursor = payload.start_time or meeting["start_time"]
    with get_connection() as conn:
        for item in items:
            end_time = add_minutes(cursor, item["duration_minutes"])
            conn.execute("UPDATE agenda_items SET start_time=?, end_time=? WHERE id=?", (cursor, end_time, item["id"]))
            cursor = end_time
    return get_meeting(meeting_id)


@app.post("/api/meetings/{meeting_id}/validate")
def validate(meeting_id: int) -> dict:
    meeting = fetch_meeting(meeting_id)
    items = fetch_agenda_items(meeting_id)
    issues = validate_meeting(meeting, items)
    with get_connection() as conn:
        conn.execute("DELETE FROM validation_results WHERE meeting_id=?", (meeting_id,))
        for item in issues:
            conn.execute(
                "INSERT INTO validation_results (meeting_id, severity, rule_code, message, agenda_item_id) VALUES (?, ?, ?, ?, ?)",
                (meeting_id, item["severity"], item["rule_code"], item["message"], item.get("agenda_item_id")),
            )
        status = "validated" if all(item["severity"] in {"ok", "warning"} for item in issues) else "needs_fix"
        conn.execute("UPDATE meetings SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (status, meeting_id))
    return {"validation_results": fetch_validations(meeting_id)}


@app.get("/api/meetings/{meeting_id}/validation-results")
def get_validation_results(meeting_id: int) -> list[dict]:
    fetch_meeting(meeting_id)
    return fetch_validations(meeting_id)


@app.get("/api/meetings/{meeting_id}/export.xlsx")
def export_excel(meeting_id: int) -> StreamingResponse:
    meeting = fetch_meeting(meeting_id)
    items = fetch_agenda_items(meeting_id)
    tasks = fetch_speaker_tasks(meeting_id)
    validations = fetch_validations(meeting_id)
    output = build_excel(meeting, items, tasks, validations)
    filename = quote(f"{meeting['name']}_会议日程.xlsx")
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


def fetch_meeting(meeting_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
    meeting = row_to_dict(row)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def fetch_agenda_item(item_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM agenda_items WHERE id=?", (item_id,)).fetchone()
    item = row_to_dict(row)
    if not item:
        raise HTTPException(status_code=404, detail="Agenda item not found")
    return item


def fetch_agenda_items(meeting_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM agenda_items WHERE meeting_id=? ORDER BY sort_order, id", (meeting_id,)).fetchall()
    return [dict(row) for row in rows]


def fetch_speaker_tasks(meeting_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM speaker_tasks WHERE meeting_id=? ORDER BY id", (meeting_id,)).fetchall()
    return [dict(row) for row in rows]


def fetch_validations(meeting_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM validation_results WHERE meeting_id=? ORDER BY id", (meeting_id,)).fetchall()
    return [dict(row) for row in rows]
