import type { AgendaItem, Meeting, MeetingInput, SpeakerTask, ValidationResult } from "./types";

type GuestExport = {
  name: string;
  province: string;
  city: string;
  hospital: string;
  department: string;
  position: string;
  role: string;
  nominationReason: string;
  notes: string;
};

const jsonHeaders = { "Content-Type": "application/json" };
const storageKey = "academic-meeting-planner-pages-data";
const isPages = typeof window !== "undefined" && window.location.hostname.endsWith("github.io");

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function withLocalFallback<T>(remote: () => Promise<T>, fallback: () => T): Promise<T> {
  if (isPages) return fallback();
  try {
    return await remote();
  } catch {
    return fallback();
  }
}

export const api = {
  listMeetings: () => withLocalFallback(() => request<Meeting[]>("/api/meetings"), listLocalMeetings),
  createMeeting: (payload: MeetingInput) =>
    withLocalFallback(
      () => request<Meeting>("/api/meetings", { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) }),
      () => createLocalMeeting(payload)
    ),
  updateMeeting: (id: number, payload: MeetingInput & { theme: string; planning_notes: string; status: string }) =>
    withLocalFallback(
      () => request<Meeting>(`/api/meetings/${id}`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify(payload) }),
      () => updateLocalMeeting(id, payload)
    ),
  generate: (id: number) =>
    withLocalFallback(() => request<Meeting>(`/api/meetings/${id}/generate`, { method: "POST" }), () => generateLocalMeeting(id)),
  updateAgendaItem: (item: AgendaItem) =>
    withLocalFallback(
      () => request<AgendaItem>(`/api/agenda-items/${item.id}`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify(item) }),
      () => updateLocalAgendaItem(item)
    ),
  createAgendaItem: (meetingId: number, item: Omit<AgendaItem, "id" | "meeting_id">) =>
    withLocalFallback(
      () =>
        request<AgendaItem>(`/api/meetings/${meetingId}/agenda-items`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(item)
        }),
      () => createLocalAgendaItem(meetingId, item)
    ),
  deleteAgendaItem: (id: number) =>
    withLocalFallback(() => request<{ deleted: boolean }>(`/api/agenda-items/${id}`, { method: "DELETE" }), () => deleteLocalAgendaItem(id)),
  reorder: (meetingId: number, itemIds: number[]) =>
    withLocalFallback(
      () =>
        request<Meeting>(`/api/meetings/${meetingId}/agenda-items/reorder`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ item_ids: itemIds })
        }),
      () => reorderLocalAgendaItems(meetingId, itemIds)
    ),
  recalculate: (meetingId: number) =>
    withLocalFallback(
      () =>
        request<Meeting>(`/api/meetings/${meetingId}/agenda-items/recalculate-time`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({})
        }),
      () => recalculateLocalAgenda(meetingId)
    ),
  validate: (meetingId: number) =>
    withLocalFallback(
      () => request<{ validation_results: Meeting["validation_results"] }>(`/api/meetings/${meetingId}/validate`, { method: "POST" }),
      () => ({ validation_results: validateLocalMeeting(meetingId) })
    ),
  exportExcel: (meeting: Meeting, agenda: AgendaItem[], guests: GuestExport[], overview: string) => {
    exportLocalWorkbook(meeting, agenda, guests, overview);
  }
};

function listLocalMeetings() {
  return readStore();
}

function createLocalMeeting(payload: MeetingInput) {
  const meetings = readStore();
  const meeting: Meeting = {
    ...payload,
    id: nextId(),
    theme: "",
    status: "draft",
    planning_notes: "",
    agenda_items: [],
    speaker_tasks: [],
    validation_results: []
  };
  writeStore([meeting, ...meetings]);
  return meeting;
}

function updateLocalMeeting(id: number, payload: MeetingInput & { theme: string; planning_notes: string; status: string }) {
  const meetings = readStore();
  const current = meetings.find((item) => item.id === id);
  const meeting: Meeting = {
    ...(current || createEmptyMeeting(id, payload)),
    ...payload
  };
  writeStore(upsertMeeting(meetings, meeting));
  return meeting;
}

function generateLocalMeeting(id: number) {
  const meetings = readStore();
  const meeting = meetings.find((item) => item.id === id);
  if (!meeting) throw new Error("会议不存在");
  const plan = buildPlan(meeting);
  const next: Meeting = {
    ...meeting,
    theme: plan.theme,
    planning_notes: plan.planning_notes,
    status: "generated",
    agenda_items: plan.agenda_items,
    speaker_tasks: plan.speaker_tasks,
    validation_results: []
  };
  writeStore(upsertMeeting(meetings, next));
  return next;
}

function updateLocalAgendaItem(item: AgendaItem) {
  const meetings = readStore();
  const updated = meetings.map((meeting) =>
    meeting.id === item.meeting_id
      ? { ...meeting, agenda_items: meeting.agenda_items.map((row) => (row.id === item.id ? item : row)) }
      : meeting
  );
  writeStore(updated);
  return item;
}

function createLocalAgendaItem(meetingId: number, item: Omit<AgendaItem, "id" | "meeting_id">) {
  const meetings = readStore();
  const nextItem: AgendaItem = { ...item, id: nextId(), meeting_id: meetingId };
  const updated = meetings.map((meeting) =>
    meeting.id === meetingId ? { ...meeting, agenda_items: [...meeting.agenda_items, nextItem] } : meeting
  );
  writeStore(updated);
  return nextItem;
}

function deleteLocalAgendaItem(id: number) {
  const meetings = readStore();
  let meetingId = 0;
  const updated = meetings.map((meeting) => {
    if (meeting.agenda_items.some((item) => item.id === id)) meetingId = meeting.id;
    return { ...meeting, agenda_items: meeting.agenda_items.filter((item) => item.id !== id) };
  });
  writeStore(updated);
  return { deleted: true, meeting_id: meetingId };
}

function reorderLocalAgendaItems(meetingId: number, itemIds: number[]) {
  const meetings = readStore();
  const meeting = meetings.find((item) => item.id === meetingId);
  if (!meeting) throw new Error("会议不存在");
  const byId = new Map(meeting.agenda_items.map((item) => [item.id, item]));
  const agenda_items = itemIds
    .map((id, index) => ({ ...byId.get(id)!, sort_order: index + 1 }))
    .filter(Boolean);
  const next = { ...meeting, agenda_items };
  writeStore(upsertMeeting(meetings, next));
  return next;
}

function recalculateLocalAgenda(meetingId: number) {
  const meetings = readStore();
  const meeting = meetings.find((item) => item.id === meetingId);
  if (!meeting) throw new Error("会议不存在");
  let cursor = meeting.start_time;
  const agenda_items = meeting.agenda_items.map((item) => {
    const next = { ...item, start_time: cursor, end_time: addMinutes(cursor, item.duration_minutes) };
    cursor = next.end_time;
    return next;
  });
  const next = { ...meeting, agenda_items };
  writeStore(upsertMeeting(meetings, next));
  return next;
}

function validateLocalMeeting(meetingId: number) {
  const meeting = readStore().find((item) => item.id === meetingId);
  if (!meeting) return [];
  const issues: ValidationResult[] = [];
  meeting.agenda_items.forEach((item) => {
    if (!item.start_time || !item.end_time) issues.push({ severity: "error", rule_code: "TIME_REQUIRED", message: "存在未填写时间的环节。" });
    if (!item.topic) issues.push({ severity: "error", rule_code: "TOPIC_REQUIRED", message: "存在未填写讲题的环节。" });
    if (item.session_format.includes("报告") && !item.speaker) issues.push({ severity: "warning", rule_code: "SPEAKER_REQUIRED", message: "主题报告建议填写讲者。" });
    if (item.session_format.includes("讨论") && !item.discussion_topic) issues.push({ severity: "warning", rule_code: "DISCUSSION_REQUIRED", message: "讨论环节建议填写讨论议题。" });
  });
  if (issues.length === 0) issues.push({ severity: "ok", rule_code: "OK", message: "日程规则检查通过。" });
  return issues;
}

function buildPlan(meeting: Meeting) {
  const templates: Record<string, string[]> = {
    城市会: ["开幕致辞", "主席致辞", "主题报告", "病例分享", "圆桌讨论", "会议总结"],
    省级论坛: ["开幕致辞", "主席致辞", "主题报告", "主题报告", "茶歇", "病例分享", "圆桌讨论", "会议总结"],
    MDT: ["主席致辞", "病例分享", "专家讨论", "圆桌讨论", "会议总结"],
    专家顾问会: ["背景介绍", "主题报告", "专家讨论", "圆桌讨论", "共识总结"],
    线上会: ["开场介绍", "主题报告", "互动答疑", "会议总结"]
  };
  const topics: Record<string, string[]> = {
    肺癌: ["NSCLC围术期临床诊疗现状及问题", "NGS检测在NSCLC围术期诊疗中的应用和探索", "ctDNA-MRD技术原理及临床发展探索"],
    胃癌: ["胃癌分子分型与精准治疗决策", "消化道肿瘤MRD检测技术及临床应用"],
    乳腺癌: ["乳腺癌分子分型与辅助治疗决策", "基因检测在乳腺癌全程管理中的应用价值"],
    结直肠癌: ["结直肠癌精准诊疗及全程管理研究进展", "RAS/BRAF/MSI检测对治疗选择的临床价值"],
    泛实体瘤: ["检测驱动的实体瘤临床治疗决策", "真实世界病例中的精准医学实践"]
  };
  const discussions: Record<string, string[]> = {
    肺癌: ["围术期患者使用NGS检测指导治疗决策时，临床最关注哪些证据和流程问题？"],
    胃癌: ["胃癌围术期治疗中，分子检测和MRD监测应如何嵌入临床路径？"],
    乳腺癌: ["乳腺癌辅助治疗决策中，基因检测结果如何与传统临床病理因素结合？"],
    结直肠癌: ["结直肠癌术后MRD阴性患者的后续治疗和监测策略应如何设计？"],
    泛实体瘤: ["多癌种场景下，精准检测报告如何更好转化为临床可执行建议？"]
  };
  const experts = { chair: "乳腺外科专家A", host: "肿瘤内科专家B", speaker: "乳腺专家C", panelist: "病理专家D" };
  const steps = templates[meeting.meeting_type] || templates.城市会;
  const durations = allocateDurations(steps, Math.max(60, minutesBetween(meeting.start_time, meeting.end_time)));
  let cursor = meeting.start_time;
  let topicIndex = 0;
  const agenda_items: AgendaItem[] = steps.map((step, index) => {
    const duration = durations[index];
    const start_time = cursor;
    const end_time = addMinutes(cursor, duration);
    cursor = end_time;
    const item: AgendaItem = {
      id: nextId() + index,
      meeting_id: meeting.id,
      sort_order: index + 1,
      section_name: step,
      session_format: step.includes("报告") ? "报告" : step.includes("讨论") || step.includes("答疑") ? "讨论" : step.includes("病例") ? "病例" : step.includes("茶歇") ? "茶歇" : "会务",
      topic: step,
      host: "",
      speaker: "",
      panelists: "",
      discussion_topic: "",
      start_time,
      end_time,
      duration_minutes: duration,
      location: meeting.location,
      execution_notes: ""
    };
    if (step.includes("报告")) {
      item.topic = topics[meeting.academic_field]?.[topicIndex % (topics[meeting.academic_field]?.length || 1)] || `${meeting.academic_field}精准诊疗专题报告`;
      item.host = experts.host;
      item.speaker = experts.speaker;
      topicIndex += 1;
    } else if (step.includes("病例")) {
      item.topic = `${meeting.academic_field}真实世界病例分享`;
      item.host = experts.host;
      item.speaker = experts.speaker;
    } else if (step.includes("讨论") || step.includes("答疑")) {
      item.topic = `${meeting.academic_field}精准诊疗实践讨论`;
      item.host = experts.host;
      item.panelists = experts.panelist;
      item.discussion_topic = discussions[meeting.academic_field]?.[0] || "精准诊疗落地中的关键问题与协作路径？";
    } else if (step.includes("致辞") || step.includes("总结")) {
      item.speaker = experts.chair;
    } else if (step.includes("茶歇")) {
      item.topic = "茶歇交流";
      item.execution_notes = "建议安排会场外交流区";
    }
    return item;
  });
  const speaker_tasks = agenda_items.flatMap((item) =>
    [
      item.host ? task(item, item.host, "会议主持") : null,
      item.speaker ? task(item, item.speaker, item.section_name.includes("致辞") ? "会议主席" : "会议讲者") : null,
      item.panelists ? task(item, item.panelists, "讨论嘉宾") : null
    ].filter(Boolean) as SpeakerTask[]
  );
  return {
    theme: `${meeting.academic_field}精准诊疗与全程管理学术交流`,
    agenda_items,
    speaker_tasks,
    planning_notes: `围绕“${meeting.goal}”设计，重点兼顾主题报告、病例交流与专家讨论。`
  };
}

function task(item: AgendaItem, expert_name: string, role: string): SpeakerTask {
  return {
    id: nextId(),
    expert_name,
    role,
    task_description: item.topic,
    time_range: `${item.start_time}-${item.end_time}`,
    notes: item.execution_notes
  };
}

function exportLocalWorkbook(meeting: Meeting, agenda: AgendaItem[], guests: GuestExport[], overview: string) {
  const sheets = [
    {
      name: "正式日程表",
      rows: [
        ["时间", "会议板块", "环节形式", "讲题", "主持人", "讲者", "讨论嘉宾", "讨论议题", "会议地点", "执行备注"],
        ...agenda.map((item) => [
          `${item.start_time}-${item.end_time}`,
          item.section_name,
          item.session_format,
          item.topic,
          item.host,
          item.speaker,
          item.panelists,
          item.discussion_topic,
          item.location,
          item.execution_notes
        ])
      ]
    },
    {
      name: "嘉宾任务表",
      rows: [
        ["参会角色", "嘉宾姓名", "省份", "城市", "医院", "科室", "职务", "提名理由", "备注"],
        ...guests.map((guest) => [guest.role, guest.name, guest.province, guest.city, guest.hospital, guest.department, guest.position, guest.nominationReason, guest.notes])
      ]
    },
    {
      name: "策划说明表",
      rows: [
        ["会议名称", meeting.name],
        ["会议主题", meeting.theme],
        ["会议时间", `${meeting.date} ${meeting.start_time}-${meeting.end_time}`],
        ["会议地点", meeting.location],
        ["会议级别", meeting.level],
        ["会议形式", meeting.format],
        ["学术领域", meeting.academic_field],
        ["会议类型", meeting.meeting_type],
        ["参会人群", meeting.audience],
        ["人数", meeting.attendee_count],
        ["会议目标", meeting.goal],
        ["会议概览", overview]
      ]
    }
  ];
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheets
  .map(
    (sheet) => `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${sheet.rows
      .map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${escapeXml(String(cell ?? ""))}</Data></Cell>`).join("")}</Row>`)
      .join("")}</Table></Worksheet>`
  )
  .join("")}
</Workbook>`;
  downloadBlob(xml, `${meeting.name || "会议策划"}_日程表.xls`, "application/vnd.ms-excel;charset=utf-8");
}

function readStore(): Meeting[] {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || "[]") as Meeting[];
  } catch {
    return [];
  }
}

function writeStore(meetings: Meeting[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(meetings));
}

function upsertMeeting(meetings: Meeting[], meeting: Meeting) {
  const exists = meetings.some((item) => item.id === meeting.id);
  return exists ? meetings.map((item) => (item.id === meeting.id ? meeting : item)) : [meeting, ...meetings];
}

function createEmptyMeeting(id: number, payload: MeetingInput): Meeting {
  return { ...payload, id, theme: "", status: "draft", planning_notes: "", agenda_items: [], speaker_tasks: [], validation_results: [] };
}

function nextId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function allocateDurations(steps: string[], totalMinutes: number) {
  const recommend: Record<string, number> = { 开幕致辞: 10, 主席致辞: 10, 开场介绍: 10, 背景介绍: 15, 主题报告: 35, 病例分享: 25, 专家讨论: 35, 圆桌讨论: 35, 互动答疑: 20, 茶歇: 20, 会议总结: 10, 共识总结: 15 };
  const base = steps.map((step) => recommend[step] || 20);
  const factor = totalMinutes / base.reduce((sum, item) => sum + item, 0);
  return base.map((minutes) => Math.max(10, Math.round((minutes * factor) / 5) * 5));
}

function isTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(time: string) {
  if (!isTime(time)) return 0;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesBetween(start: string, end: string) {
  return timeToMinutes(end) - timeToMinutes(start);
}

function addMinutes(time: string, minutes: number) {
  const total = timeToMinutes(time) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob(["\ufeff", content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
