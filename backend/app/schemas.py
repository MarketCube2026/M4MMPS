from __future__ import annotations

from pydantic import BaseModel, Field


class MeetingBase(BaseModel):
    name: str
    date: str
    start_time: str
    end_time: str
    location: str
    level: str
    format: str
    academic_field: str
    meeting_type: str
    goal: str
    audience: str
    attendee_count: int = Field(ge=1)


class MeetingCreate(MeetingBase):
    pass


class MeetingUpdate(MeetingBase):
    theme: str = ""
    planning_notes: str = ""
    status: str = "draft"


class AgendaItemBase(BaseModel):
    sort_order: int
    section_name: str
    session_format: str
    topic: str
    host: str = ""
    speaker: str = ""
    panelists: str = ""
    discussion_topic: str = ""
    start_time: str
    end_time: str
    duration_minutes: int = Field(ge=1)
    location: str
    execution_notes: str = ""


class AgendaItemCreate(AgendaItemBase):
    pass


class AgendaItemUpdate(AgendaItemBase):
    pass


class ReorderRequest(BaseModel):
    item_ids: list[int]


class RecalculateRequest(BaseModel):
    changed_item_id: int | None = None
    start_time: str | None = None

