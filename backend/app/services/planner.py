from __future__ import annotations

from app.services.time_utils import add_minutes, minutes_between

MEETING_TEMPLATES = {
    "城市会": ["开幕致辞", "主席致辞", "主题报告", "病例分享", "圆桌讨论", "会议总结"],
    "省级论坛": ["开幕致辞", "主席致辞", "主题报告", "主题报告", "茶歇", "病例分享", "圆桌讨论", "会议总结"],
    "MDT": ["主席致辞", "病例分享", "专家讨论", "圆桌讨论", "会议总结"],
    "专家顾问会": ["背景介绍", "主题报告", "专家讨论", "圆桌讨论", "共识总结"],
    "线上会": ["开场介绍", "主题报告", "互动答疑", "会议总结"],
}

RULE_MINUTES = {
    "开幕致辞": {"min": 5, "recommend": 10, "max": 15},
    "主席致辞": {"min": 5, "recommend": 10, "max": 15},
    "开场介绍": {"min": 5, "recommend": 10, "max": 15},
    "背景介绍": {"min": 10, "recommend": 15, "max": 20},
    "主题报告": {"min": 20, "recommend": 30, "max": 45},
    "病例分享": {"min": 15, "recommend": 25, "max": 30},
    "专家讨论": {"min": 20, "recommend": 30, "max": 45},
    "圆桌讨论": {"min": 20, "recommend": 30, "max": 40},
    "互动答疑": {"min": 10, "recommend": 20, "max": 30},
    "茶歇": {"min": 15, "recommend": 20, "max": 30},
    "会议总结": {"min": 5, "recommend": 10, "max": 15},
    "共识总结": {"min": 10, "recommend": 15, "max": 20},
}

TOPICS = {
    "肺癌": ["NSCLC围术期临床诊疗现状及问题", "NGS检测在NSCLC围术期诊疗中的应用和探索", "ctDNA-MRD技术原理及临床发展探索"],
    "胃癌": ["胃癌分子分型与精准治疗决策", "消化道肿瘤MRD检测技术及临床应用", "胃癌围术期治疗进展与检测策略"],
    "乳腺癌": ["乳腺癌分子分型与辅助治疗决策", "基因检测在乳腺癌全程管理中的应用价值"],
    "结直肠癌": ["结直肠癌精准诊疗及全程管理最新研究进展", "RAS/BRAF/MSI检测对治疗选择的临床价值"],
    "泛实体瘤": ["检测驱动的实体瘤临床治疗决策", "真实世界病例中的精准医学实践"],
}

DISCUSSIONS = {
    "肺癌": ["围术期患者使用NGS检测指导治疗决策时，临床最关注哪些证据和流程问题？", "免疫、靶向治疗前移背景下，分子检测如何更好服务早中期肺癌患者？"],
    "胃癌": ["胃癌围术期治疗中，分子检测和MRD监测应如何嵌入临床路径？"],
    "乳腺癌": ["乳腺癌辅助治疗决策中，基因检测结果如何与传统临床病理因素结合？"],
    "结直肠癌": ["结直肠癌术后MRD阳性患者的后续治疗和监测策略应如何设计？"],
    "泛实体瘤": ["多癌种场景下，精准检测报告如何更好转化为临床可执行建议？"],
}

EXPERTS = {
    "肺癌": {"主席": "杨明磊", "主持": "陈静璐", "讲者": "张国庆", "讨论嘉宾": "徐艳珺"},
    "胃癌": {"主席": "消化肿瘤专家A", "主持": "病理专家B", "讲者": "消化肿瘤专家C", "讨论嘉宾": "胃肠外科专家D"},
    "乳腺癌": {"主席": "乳腺外科专家A", "主持": "肿瘤内科专家B", "讲者": "乳腺专家C", "讨论嘉宾": "病理专家D"},
    "结直肠癌": {"主席": "消化肿瘤专家A", "主持": "胃肠外科专家B", "讲者": "结直肠癌专家C", "讨论嘉宾": "分子病理专家D"},
    "泛实体瘤": {"主席": "MDT专家A", "主持": "临床专家B", "讲者": "精准医学专家C", "讨论嘉宾": "检测专家D"},
}


def allocate_durations(steps: list[str], total_minutes: int) -> list[int]:
    recommended = [RULE_MINUTES.get(step, {"recommend": 20})["recommend"] for step in steps]
    rec_total = sum(recommended) or 1
    factor = total_minutes / rec_total
    durations: list[int] = []
    for step, rec in zip(steps, recommended, strict=True):
        rule = RULE_MINUTES.get(step, {"min": 10, "max": 45})
        scaled = round((rec * factor) / 5) * 5
        durations.append(max(rule["min"], min(rule["max"], scaled)))
    return durations


def generate_plan(meeting: dict) -> dict:
    total_minutes = max(60, minutes_between(meeting["start_time"], meeting["end_time"]))
    field = meeting["academic_field"]
    steps = MEETING_TEMPLATES.get(meeting["meeting_type"], MEETING_TEMPLATES["城市会"])
    durations = allocate_durations(steps, total_minutes)
    topics = TOPICS.get(field, TOPICS["泛实体瘤"])
    discussions = DISCUSSIONS.get(field, DISCUSSIONS["泛实体瘤"])
    experts = EXPERTS.get(field, EXPERTS["泛实体瘤"])
    agenda_items = []
    speaker_tasks = []
    cursor = meeting["start_time"]
    topic_index = 0
    discussion_index = 0

    for index, (step, duration) in enumerate(zip(steps, durations, strict=True), start=1):
        end_time = add_minutes(cursor, duration)
        item = {
            "sort_order": index,
            "section_name": step,
            "session_format": "报告" if step == "主题报告" else "讨论" if "讨论" in step or step == "互动答疑" else "会务",
            "topic": step,
            "host": "",
            "speaker": "",
            "panelists": "",
            "discussion_topic": "",
            "start_time": cursor,
            "end_time": end_time,
            "duration_minutes": duration,
            "location": meeting["location"],
            "execution_notes": "",
        }

        if step == "主题报告":
            item["topic"] = topics[topic_index % len(topics)]
            item["speaker"] = experts["讲者"]
            item["host"] = experts["主持"]
            topic_index += 1
        elif step == "病例分享":
            item["topic"] = f"{field}真实世界病例分享"
            item["speaker"] = experts["讲者"]
            item["host"] = experts["主持"]
        elif "讨论" in step or step == "互动答疑":
            item["topic"] = f"{field}精准诊疗实践讨论"
            item["host"] = experts["主持"]
            item["panelists"] = experts["讨论嘉宾"]
            item["discussion_topic"] = discussions[discussion_index % len(discussions)]
            discussion_index += 1
        elif "致辞" in step or step == "开场介绍":
            item["speaker"] = experts["主席"]
        elif step == "茶歇":
            item["topic"] = "茶歇交流"
            item["execution_notes"] = "建议安排会场外交流区"
        elif "总结" in step:
            item["speaker"] = experts["主席"]

        agenda_items.append(item)
        for role, name in [("主持", item["host"]), ("讲者", item["speaker"]), ("讨论嘉宾", item["panelists"])]:
            if name:
                speaker_tasks.append(
                    {
                        "expert_name": name,
                        "role": role,
                        "task_description": item["topic"],
                        "time_range": f"{item['start_time']}-{item['end_time']}",
                        "notes": item["execution_notes"],
                    }
                )
        cursor = end_time

    return {
        "theme": f"{field}精准诊疗与全程管理学术交流",
        "framework": steps,
        "agenda_items": agenda_items,
        "speaker_tasks": speaker_tasks,
        "discussion_topics": discussions,
        "planning_notes": f"围绕“{meeting['goal']}”设计，重点兼顾主题报告、病例交流与专家讨论。",
    }

