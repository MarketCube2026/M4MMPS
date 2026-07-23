from __future__ import annotations

from datetime import datetime, timedelta

TIME_FORMAT = "%H:%M"


def parse_time(value: str) -> datetime:
    return datetime.strptime(value, TIME_FORMAT)


def add_minutes(value: str, minutes: int) -> str:
    return (parse_time(value) + timedelta(minutes=minutes)).strftime(TIME_FORMAT)


def minutes_between(start: str, end: str) -> int:
    start_dt = parse_time(start)
    end_dt = parse_time(end)
    diff = int((end_dt - start_dt).total_seconds() / 60)
    return diff


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return parse_time(a_start) < parse_time(b_end) and parse_time(b_start) < parse_time(a_end)

