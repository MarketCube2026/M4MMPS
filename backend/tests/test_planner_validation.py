from __future__ import annotations

import unittest

from app.services.planner import generate_plan
from app.services.validation import validate_meeting


class PlannerValidationTests(unittest.TestCase):
    def meeting(self) -> dict:
        return {
            "name": "肺癌精准诊疗城市会",
            "date": "2026-08-06",
            "start_time": "14:00",
            "end_time": "17:00",
            "location": "会议酒店",
            "level": "区域级",
            "format": "线下",
            "academic_field": "肺癌",
            "meeting_type": "城市会",
            "goal": "提升围术期精准诊疗交流质量",
            "audience": "肿瘤科、胸外科专家",
            "attendee_count": 50,
        }

    def test_generate_half_day_plan_as_structured_json(self) -> None:
        plan = generate_plan(self.meeting())
        self.assertIn("theme", plan)
        self.assertGreaterEqual(len(plan["agenda_items"]), 5)
        self.assertEqual(plan["agenda_items"][0]["start_time"], "14:00")
        self.assertTrue(any(item["section_name"] == "主题报告" for item in plan["agenda_items"]))

    def test_validation_detects_overlap(self) -> None:
        meeting = self.meeting()
        agenda = generate_plan(meeting)["agenda_items"]
        agenda[1]["start_time"] = agenda[0]["start_time"]
        agenda[1]["end_time"] = agenda[0]["end_time"]
        issues = validate_meeting(meeting, agenda)
        self.assertTrue(any(item["rule_code"] == "TIME_OVERLAP" for item in issues))


if __name__ == "__main__":
    unittest.main()
