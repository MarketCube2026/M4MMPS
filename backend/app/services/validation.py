from __future__ import annotations

from collections import defaultdict

from app.services.planner import RULE_MINUTES
from app.services.time_utils import minutes_between, overlaps


def validate_meeting(meeting: dict, agenda_items: list[dict]) -> list[dict]:
    issues: list[dict] = []
    total = 0

    for item in agenda_items:
        item_id = item.get("id")
        duration = minutes_between(item["start_time"], item["end_time"])
        total += duration
        if duration <= 0:
            issues.append(issue("error", "INVALID_TIME", "环节结束时间必须晚于开始时间。", item_id))
        if not item.get("topic") and item["section_name"] != "茶歇":
            issues.append(issue("error", "MISSING_TOPIC", "非茶歇环节必须填写讲题或主题。", item_id))
        if item["section_name"] == "主题报告" and not item.get("speaker"):
            issues.append(issue("error", "MISSING_SPEAKER", "主题报告必须填写讲者。", item_id))
        if "讨论" in item["section_name"] and not item.get("discussion_topic"):
            issues.append(issue("warning", "MISSING_DISCUSSION_TOPIC", "讨论环节建议填写讨论议题。", item_id))
        rule = RULE_MINUTES.get(item["section_name"])
        if rule and duration > rule["max"]:
            issues.append(issue("warning", "SESSION_TOO_LONG", f"{item['section_name']}超过建议上限{rule['max']}分钟。", item_id))

    for index, current in enumerate(agenda_items):
        for other in agenda_items[index + 1 :]:
            if overlaps(current["start_time"], current["end_time"], other["start_time"], other["end_time"]):
                issues.append(issue("error", "TIME_OVERLAP", f"{current['section_name']}与{other['section_name']}时间重叠。", current.get("id")))

    meeting_minutes = minutes_between(meeting["start_time"], meeting["end_time"])
    if total > meeting_minutes:
        issues.append(issue("warning", "TOTAL_DURATION_EXCEEDED", f"日程合计{total}分钟，超过会议时长{meeting_minutes}分钟。"))

    expert_slots: dict[str, list[dict]] = defaultdict(list)
    for item in agenda_items:
        for field in ("host", "speaker", "panelists"):
            names = [name.strip() for name in str(item.get(field, "")).replace("、", ",").split(",") if name.strip()]
            for name in names:
                expert_slots[name].append(item)
    for expert, slots in expert_slots.items():
        for index, current in enumerate(slots):
            for other in slots[index + 1 :]:
                if overlaps(current["start_time"], current["end_time"], other["start_time"], other["end_time"]):
                    issues.append(issue("error", "EXPERT_CONFLICT", f"{expert}在重叠时段被安排了多个任务。", current.get("id")))

    speaker_minutes: dict[str, int] = defaultdict(int)
    for item in agenda_items:
        for name in [item.get("host"), item.get("speaker"), item.get("panelists")]:
            if name:
                speaker_minutes[name] += minutes_between(item["start_time"], item["end_time"])
    for expert, minutes in speaker_minutes.items():
        if minutes > 60:
            issues.append(issue("warning", "CONTINUOUS_EXPERT_LOAD", f"{expert}累计连续任务约{minutes}分钟，建议安排休息或替换角色。"))

    if not issues:
        issues.append(issue("ok", "PASSED", "规则校验通过。"))
    return issues


def issue(severity: str, rule_code: str, message: str, agenda_item_id: int | None = None) -> dict:
    return {
        "severity": severity,
        "rule_code": rule_code,
        "message": message,
        "agenda_item_id": agenda_item_id,
    }

