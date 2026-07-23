import {
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UpOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Layout,
  message,
  Segmented,
  Select,
  Space,
  Tag,
  Typography
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AgendaItem, Meeting, MeetingInput, ValidationResult } from "./types";

const { Header, Content } = Layout;
const guestRoleOptions = ["会议主席", "会议主持", "会议讲者", "讨论嘉宾", "特邀嘉宾", "其他"];

type Guest = {
  id: string;
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

const initialValues = {
  name: "肺癌精准诊疗城市会",
  date: dayjs().add(14, "day"),
  start_time: "14:00",
  end_time: "17:00",
  location: "待定会议酒店",
  level: "区域级",
  format: "线下",
  academic_field: "肺癌",
  meeting_type: "城市会",
  goal: "强化NGS检测在围术期精准诊疗中的临床价值，提升区域专家交流和病例互动质量。",
  audience: "肿瘤科、胸外科、病理科专家",
  attendee_count: 50
};

function App() {
  const [form] = Form.useForm();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [agendaMode, setAgendaMode] = useState<"edit" | "view">("edit");
  const [activeBoard, setActiveBoard] = useState<"agenda" | "guests">("agenda");
  const [guestMode, setGuestMode] = useState<"edit" | "view">("edit");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .listMeetings()
      .then((items) => {
        if (items[0]) {
          setMeeting(items[0]);
          setAgenda(items[0].agenda_items || []);
          form.setFieldsValue({ ...items[0], date: dayjs(items[0].date) });
        }
      })
      .catch(() => undefined);
  }, [form]);

  useEffect(() => {
    setGuests((current) => deriveGuestsFromAgenda(agenda, current));
  }, [agenda]);

  useEffect(() => {
    if (!meeting) return;
    const stored = window.localStorage.getItem(guestStorageKey(meeting.id));
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Guest[];
      setGuests(deriveGuestsFromAgenda(agenda, parsed));
    } catch {
      // Ignore incompatible local data.
    }
  }, [meeting?.id]);

  useEffect(() => {
    if (!meeting || guests.length === 0) return;
    window.localStorage.setItem(guestStorageKey(meeting.id), JSON.stringify(guests));
  }, [meeting?.id, guests]);

  const validationSummary = useMemo(() => summarizeValidations(meeting?.validation_results || []), [meeting]);
  const meetingKeyPoints = useMemo(() => getMeetingKeyPoints(meeting, agenda), [meeting, agenda]);
  const planningText = buildOverviewText(meeting?.planning_notes, meetingKeyPoints);

  const saveMeeting = async () => {
    const payload = toMeetingInput(await form.validateFields());
    setLoading(true);
    try {
      const next = meeting
        ? await api.updateMeeting(meeting.id, {
            ...payload,
            theme: meeting.theme,
            planning_notes: meeting.planning_notes,
            status: meeting.status
          })
        : await api.createMeeting(payload);
      setMeeting(next);
      setAgenda(next.agenda_items || []);
      message.success("会议已保存");
      return next;
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    const current = await saveMeeting();
    setLoading(true);
    try {
      const next = await api.generate(current.id);
      setMeeting(next);
      setAgenda(next.agenda_items);
      message.success("已生成结构化会议策划");
    } finally {
      setLoading(false);
    }
  };

  const updateCell = (id: number, field: keyof AgendaItem, value: string | number) => {
    const current = agenda.find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, [field]: value };
    if (field === "duration_minutes") {
      next.end_time = addMinutes(next.start_time, Number(value));
    }
    setAgenda((items) => items.map((item) => (item.id === id ? next : item)));
    void api.updateAgendaItem(next);
  };

  const updateStartTime = (id: number, value: string) => {
    if (!isTime(value)) {
      updateCell(id, "start_time", value);
      return;
    }
    const index = agenda.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = agenda.map((item) => ({ ...item }));
    next[index].start_time = value;
    next[index].end_time = addMinutes(value, next[index].duration_minutes);
    const cascaded = cascadeTimes(next, index + 1);
    setAgenda(cascaded);
    void saveAgendaRows(cascaded.slice(index));
  };

  const updateEndTime = (id: number, value: string) => {
    const index = agenda.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = agenda.map((item) => ({ ...item }));
    next[index].end_time = value;
    const duration = minutesBetween(next[index].start_time, value);
    if (duration > 0) {
      next[index].duration_minutes = duration;
      const cascaded = cascadeTimes(next, index + 1);
      setAgenda(cascaded);
      void saveAgendaRows(cascaded.slice(index));
      return;
    }
    setAgenda(next);
  };

  const updateDuration = (id: number, value: number) => {
    const index = agenda.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = agenda.map((item) => ({ ...item }));
    next[index].duration_minutes = value;
    next[index].end_time = addMinutes(next[index].start_time, value);
    const cascaded = cascadeTimes(next, index + 1);
    setAgenda(cascaded);
    void saveAgendaRows(cascaded.slice(index));
  };

  const persistAllAgenda = async () => {
    await saveAgendaRows(agenda);
  };

  const saveAgendaRows = async (rows: AgendaItem[]) => {
    await Promise.all(rows.map((item) => api.updateAgendaItem(item)));
  };

  const persistAgendaById = async (id: number) => {
    const latest = agenda.find((item) => item.id === id);
    if (!latest) return;
    const saved = await api.updateAgendaItem(latest);
    setAgenda((items) => items.map((row) => (row.id === saved.id ? saved : row)));
  };

  const addRow = async () => {
    if (!meeting) {
      message.warning("请先保存会议");
      return;
    }
    const last = agenda[agenda.length - 1];
    const start = last?.end_time || meeting.start_time;
    const item = await api.createAgendaItem(meeting.id, {
      sort_order: agenda.length + 1,
      section_name: "自定义环节",
      session_format: "报告",
      topic: "待填写",
      host: "",
      speaker: "",
      panelists: "",
      discussion_topic: "",
      start_time: start,
      end_time: addMinutes(start, 20),
      duration_minutes: 20,
      location: meeting.location,
      execution_notes: ""
    });
    setAgenda([...agenda, item]);
  };

  const removeRow = async (item: AgendaItem) => {
    await api.deleteAgendaItem(item.id);
    setAgenda(agenda.filter((row) => row.id !== item.id));
  };

  const moveRow = async (index: number, direction: -1 | 1) => {
    if (!meeting) return;
    const target = index + direction;
    if (target < 0 || target >= agenda.length) return;
    const next = [...agenda];
    [next[index], next[target]] = [next[target], next[index]];
    setAgenda(next);
    const saved = await api.reorder(meeting.id, next.map((item) => item.id));
    setMeeting(saved);
    setAgenda(saved.agenda_items);
  };

  const recalculate = async () => {
    if (!meeting) return;
    await persistAllAgenda();
    const next = await api.recalculate(meeting.id);
    setMeeting(next);
    setAgenda(next.agenda_items);
    message.success("已重算后续时间");
  };

  const exportExcel = async () => {
    if (!meeting) {
      message.warning("请先保存并生成会议");
      return;
    }
    await persistAllAgenda();
    window.location.href = `/api/meetings/${meeting.id}/export.xlsx`;
  };

  return (
    <Layout className="app-shell">
      <Header className="topbar">
        <Typography.Title level={2}>学术会议策划小助手</Typography.Title>
        <Space wrap>
          <Tag>{agenda.length} 个日程项</Tag>
          <Tag color={validationSummary.color}>{validationSummary.text}</Tag>
          {meeting && <Tag color="blue">会议ID {meeting.id}</Tag>}
        </Space>
      </Header>

      <Content className="workbench">
        <Card title="填写需求" className="side-panel">
          <div className="panel-scroll">
            <Form form={form} layout="vertical" initialValues={initialValues}>
              <Form.Item name="name" label="会议名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <div className="two-col">
                <Form.Item name="meeting_type" label="会议类型">
                  <Select options={options(["城市会", "省级论坛", "MDT", "专家顾问会", "线上会"])} />
                </Form.Item>
                <Form.Item name="academic_field" label="学术领域">
                  <Select options={options(["肺癌", "胃癌", "乳腺癌", "结直肠癌", "泛实体瘤"])} />
                </Form.Item>
              </div>
              <div className="two-col">
                <Form.Item name="date" label="会议日期" rules={[{ required: true }]}>
                  <DatePicker className="full" />
                </Form.Item>
                <Form.Item name="attendee_count" label="人数">
                  <InputNumber min={1} className="full" />
                </Form.Item>
              </div>
              <div className="two-col">
                <Form.Item name="start_time" label="开始时间">
                  <Input />
                </Form.Item>
                <Form.Item name="end_time" label="结束时间">
                  <Input />
                </Form.Item>
              </div>
              <Form.Item name="location" label="会议地点">
                <Input />
              </Form.Item>
              <div className="two-col">
                <Form.Item name="level" label="会议级别">
                  <Select options={options(["区域级", "省级", "全国级"])} />
                </Form.Item>
                <Form.Item name="format" label="会议形式">
                  <Select options={options(["线下", "线上", "线上+线下"])} />
                </Form.Item>
              </div>
              <Form.Item name="audience" label="参会人群">
                <Input />
              </Form.Item>
              <Form.Item name="goal" label="会议目标">
                <Input.TextArea rows={4} />
              </Form.Item>
              <Space wrap className="form-actions">
                <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={saveMeeting}>
                  保存会议
                </Button>
                <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={generate}>
                  生成策划
                </Button>
              </Space>
            </Form>
          </div>
        </Card>

        <div className="workspace">
          <Card title="会议概览" className="overview-card">
            <div className="brief-grid">
              <div className="brief-item">
                <b>会议主题</b>
                <span>{meeting?.theme || "尚未生成"}</span>
              </div>
              <div className="brief-item">
                <b>会议时间</b>
                <span>{meeting ? `${meeting.date} ${meeting.start_time}-${meeting.end_time}` : "尚未保存"}</span>
              </div>
              <div className="brief-item">
                <b>地点与规模</b>
                <span>{meeting ? `${meeting.location} / ${meeting.attendee_count}人` : "尚未保存"}</span>
              </div>
              <div className="brief-item">
                <b>策划状态</b>
                <span>{validationSummary.text}</span>
              </div>
            </div>
            <div className="overview-summary">
              <div className="summary-main">
                <b>会议概览</b>
                <Input.TextArea
                  autoSize={false}
                  value={planningText}
                  onChange={(event) => updateMeetingDraft("planning_notes", event.target.value)}
                  onBlur={saveMeetingDraft}
                />
              </div>
            </div>
          </Card>

          <Card
            title={activeBoard === "agenda" ? (agendaMode === "edit" ? "编辑日程" : "日程视图") : "参会嘉宾"}
            className="agenda-card"
            extra={
              <Space wrap>
                <Segmented
                  className="board-switch"
                  value={activeBoard}
                  onChange={(value) => setActiveBoard(value as "agenda" | "guests")}
                  options={[
                    { label: "日程安排", value: "agenda" },
                    { label: "参会嘉宾", value: "guests" }
                  ]}
                />
                {activeBoard === "agenda" && (
                  <>
                    <Segmented
                      className="mode-switch"
                      value={agendaMode}
                      onChange={(value) => setAgendaMode(value as "edit" | "view")}
                      options={[
                        { label: "编辑版", value: "edit" },
                        { label: "视图版", value: "view" }
                      ]}
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={addRow}>
                      新增环节
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={recalculate}>
                      重算时间
                    </Button>
                  </>
                )}
                {activeBoard === "guests" && (
                  <>
                    <Segmented
                      className="mode-switch"
                      value={guestMode}
                      onChange={(value) => setGuestMode(value as "edit" | "view")}
                      options={[
                        { label: "编辑版", value: "edit" },
                        { label: "视图版", value: "view" }
                      ]}
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={addGuest}>
                      新增嘉宾
                    </Button>
                  </>
                )}
                <Button type="primary" icon={<DownloadOutlined />} onClick={exportExcel}>
                  导出Excel
                </Button>
              </Space>
            }
          >
            {activeBoard === "agenda" ? (
              agendaMode === "edit" ? (
                <div className="agenda-list">
                  {agenda.length === 0 && <div className="empty-agenda">填写需求后点击“生成策划”，或先保存会议后新增环节。</div>}
                  {agenda.map((item, index) => (
                    <AgendaEditCard
                      key={item.id}
                      item={item}
                      index={index}
                      updateStartTime={updateStartTime}
                      updateEndTime={updateEndTime}
                      updateDuration={updateDuration}
                      updateCell={updateCell}
                      persistAllAgenda={persistAllAgenda}
                      persistAgendaById={persistAgendaById}
                      moveRow={moveRow}
                      removeRow={removeRow}
                    />
                  ))}
                </div>
              ) : (
                <AgendaView items={agenda} />
              )
            ) : (
              guestMode === "edit" ? <GuestBoard guests={guests} saveGuests={saveGuests} onGuestChange={syncGuestToAgenda} /> : <GuestView guests={guests} />
            )}
          </Card>
        </div>
      </Content>
    </Layout>
  );

  function updateMeetingDraft(field: "planning_notes", value: string) {
    if (!meeting) return;
    setMeeting({ ...meeting, [field]: value });
  }

  async function saveMeetingDraft() {
    if (!meeting) return;
    const payload = toMeetingInput(await form.validateFields());
    const next = await api.updateMeeting(meeting.id, {
      ...payload,
      theme: meeting.theme,
      planning_notes: meeting.planning_notes,
      status: meeting.status
    });
    setMeeting(next);
  }

  function syncGuestToAgenda(previous: Guest, nextGuest: Guest) {
    if (previous.name === nextGuest.name && previous.role === nextGuest.role) return;
    const changedRows: AgendaItem[] = [];
    const updated = agenda.map((item) => {
        let nextItem = { ...item };
        let changed = false;
        (["host", "speaker", "panelists"] as const).forEach((field) => {
          const replaced = replaceGuestName(nextItem[field], previous.name, nextGuest.name);
          if (replaced !== nextItem[field]) {
            nextItem = { ...nextItem, [field]: replaced };
            changed = true;
          }
        });

        if (previous.role !== nextGuest.role && nextGuest.name) {
          const oldFields = fieldsForGuestRole(previous.role);
          const newFields = fieldsForGuestRole(nextGuest.role);
          const rowContainsGuest = oldFields.some((field) => splitNames(nextItem[field]).includes(nextGuest.name));
          if (rowContainsGuest) {
            oldFields.forEach((field) => {
              const removed = removeGuestName(nextItem[field], nextGuest.name);
              if (removed !== nextItem[field]) {
                nextItem = { ...nextItem, [field]: removed };
                changed = true;
              }
            });
            newFields.forEach((field) => {
              const added = addGuestName(nextItem[field], nextGuest.name);
              if (added !== nextItem[field]) {
                nextItem = { ...nextItem, [field]: added };
                changed = true;
              }
            });
          }
        }

        if (changed) changedRows.push(nextItem);
        return nextItem;
    });
    setAgenda(updated);
    void saveAgendaRows(changedRows);
  }

  function addGuest() {
    const id = `guest-${Date.now()}`;
    saveGuests([
      ...guests,
      {
        id,
        name: "待填写嘉宾",
        province: "",
        city: "",
        hospital: "",
        department: "",
        position: "",
        role: "其他",
        nominationReason: "",
        notes: ""
      }
    ]);
  }

  function saveGuests(nextGuests: Guest[]) {
    setGuests(nextGuests);
    if (meeting) {
      window.localStorage.setItem(guestStorageKey(meeting.id), JSON.stringify(nextGuests));
    }
  }
}

function AgendaEditCard(props: {
  item: AgendaItem;
  index: number;
  updateStartTime: (id: number, value: string) => void;
  updateEndTime: (id: number, value: string) => void;
  updateDuration: (id: number, value: number) => void;
  updateCell: (id: number, field: keyof AgendaItem, value: string | number) => void;
  persistAllAgenda: () => void;
  persistAgendaById: (id: number) => void;
  moveRow: (index: number, direction: -1 | 1) => void;
  removeRow: (item: AgendaItem) => void;
}) {
  const { item, index } = props;
  return (
    <div className="agenda-item">
      <div className="agenda-index">
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>

      <div className="agenda-main">
        <div className="agenda-line">
          <div className="time-editor">
            <Input value={item.start_time} onChange={(event) => props.updateStartTime(item.id, event.target.value)} onBlur={props.persistAllAgenda} />
            <span>-</span>
            <Input value={item.end_time} onChange={(event) => props.updateEndTime(item.id, event.target.value)} onBlur={props.persistAllAgenda} />
          </div>
          <Input className="section-input" value={item.section_name} onChange={(event) => props.updateCell(item.id, "section_name", event.target.value)} onBlur={() => props.persistAgendaById(item.id)} />
          <Select
            className="format-select"
            value={item.session_format}
            options={options(["会务", "报告", "讨论", "病例", "茶歇"])}
            onChange={(value) => props.updateCell(item.id, "session_format", value)}
            onBlur={() => props.persistAgendaById(item.id)}
          />
          <InputNumber min={1} value={item.duration_minutes} onChange={(value) => props.updateDuration(item.id, Number(value || 1))} onBlur={props.persistAllAgenda} addonAfter="分钟" />
        </div>

        <Input className="topic-input" value={item.topic} onChange={(event) => props.updateCell(item.id, "topic", event.target.value)} onBlur={() => props.persistAgendaById(item.id)} placeholder="讲题/主题" />

        <div className="person-grid">
          <LabeledInput label="主持人" value={item.host} onChange={(value) => props.updateCell(item.id, "host", value)} onBlur={() => props.persistAgendaById(item.id)} />
          <LabeledInput label="讲者" value={item.speaker} onChange={(value) => props.updateCell(item.id, "speaker", value)} onBlur={() => props.persistAgendaById(item.id)} />
          <LabeledInput label="讨论嘉宾" value={item.panelists} onChange={(value) => props.updateCell(item.id, "panelists", value)} onBlur={() => props.persistAgendaById(item.id)} />
        </div>

        <div className="detail-grid">
          <LabeledInput label="讨论议题" value={item.discussion_topic} onChange={(value) => props.updateCell(item.id, "discussion_topic", value)} onBlur={() => props.persistAgendaById(item.id)} />
          <LabeledInput label="会议地点" value={item.location} onChange={(value) => props.updateCell(item.id, "location", value)} onBlur={() => props.persistAgendaById(item.id)} />
          <LabeledInput label="执行备注" value={item.execution_notes} onChange={(value) => props.updateCell(item.id, "execution_notes", value)} onBlur={() => props.persistAgendaById(item.id)} />
        </div>
      </div>

      <div className="agenda-actions">
        <Button aria-label="上移" icon={<UpOutlined />} onClick={() => props.moveRow(index, -1)} />
        <Button aria-label="下移" icon={<DownOutlined />} onClick={() => props.moveRow(index, 1)} />
        <Button danger aria-label="删除" icon={<DeleteOutlined />} onClick={() => props.removeRow(item)} />
      </div>
    </div>
  );
}

function AgendaView({ items }: { items: AgendaItem[] }) {
  if (items.length === 0) {
    return <div className="empty-agenda">暂无日程，生成策划后查看。</div>;
  }

  return (
    <div className="agenda-view">
      {items.map((item, index) => (
        <div className="view-row" key={item.id}>
          <div className="view-time">
            <strong>{item.start_time}</strong>
            <span>{item.end_time}</span>
          </div>
          <div className="view-rail">
            <span>{String(index + 1).padStart(2, "0")}</span>
          </div>
          <div className="view-content">
            <div className="view-head">
              <Tag color={formatColor(item.session_format)}>{item.section_name}</Tag>
              <b>{item.topic || "待填写讲题"}</b>
              <em>{item.duration_minutes} 分钟</em>
            </div>
            <div className="view-meta">
              {item.host && <span>主持：{item.host}</span>}
              {item.speaker && <span>讲者：{item.speaker}</span>}
              {item.panelists && <span>讨论嘉宾：{item.panelists}</span>}
              {item.location && <span>地点：{item.location}</span>}
            </div>
            {item.discussion_topic && <div className="view-discussion">讨论议题：{item.discussion_topic}</div>}
            {item.execution_notes && <div className="view-note">备注：{item.execution_notes}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function GuestBoard({
  guests,
  saveGuests,
  onGuestChange
}: {
  guests: Guest[];
  saveGuests: (nextGuests: Guest[]) => void;
  onGuestChange: (previous: Guest, nextGuest: Guest) => void;
}) {
  const updateGuest = (id: string, field: keyof Guest, value: string) => {
    const previous = guests.find((item) => item.id === id);
    const nextGuest = previous ? { ...previous, [field]: value } : undefined;
    saveGuests(guests.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    if (previous && nextGuest && (field === "name" || field === "role")) {
      onGuestChange(previous, nextGuest);
    }
  };

  if (guests.length === 0) {
    return <div className="empty-agenda">暂无参会嘉宾。生成或填写日程中的主持人、讲者、讨论嘉宾后会自动汇总。</div>;
  }

  return (
    <div className="guest-board">
      {guests.map((guest, index) => (
        <div className="guest-card" key={guest.id}>
          <div className="guest-card-head">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <Input value={guest.name} onChange={(event) => updateGuest(guest.id, "name", event.target.value)} />
            <Select
              showSearch
              value={guest.role}
              options={options(guestRoleOptions)}
              onChange={(value) => updateGuest(guest.id, "role", value)}
              onSearch={(value) => updateGuest(guest.id, "role", value)}
            />
          </div>
          <div className="guest-grid">
            <GuestField label="省份" value={guest.province} onChange={(value) => updateGuest(guest.id, "province", value)} />
            <GuestField label="城市" value={guest.city} onChange={(value) => updateGuest(guest.id, "city", value)} />
            <GuestField label="医院" value={guest.hospital} onChange={(value) => updateGuest(guest.id, "hospital", value)} />
            <GuestField label="科室" value={guest.department} onChange={(value) => updateGuest(guest.id, "department", value)} />
            <GuestField label="职务" value={guest.position} onChange={(value) => updateGuest(guest.id, "position", value)} />
            <GuestField label="提名理由" value={guest.nominationReason} onChange={(value) => updateGuest(guest.id, "nominationReason", value)} wide />
            <GuestField label="备注" value={guest.notes} onChange={(value) => updateGuest(guest.id, "notes", value)} wide />
          </div>
        </div>
      ))}
    </div>
  );
}

function GuestField(props: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className={props.wide ? "guest-field guest-field-wide" : "guest-field"}>
      <span>{props.label}</span>
      <Input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function GuestView({ guests }: { guests: Guest[] }) {
  if (guests.length === 0) {
    return <div className="empty-agenda">暂无参会嘉宾。生成或填写日程中的主持人、讲者、讨论嘉宾后会自动汇总。</div>;
  }

  return (
    <div className="guest-view">
      <table className="guest-view-table">
        <thead>
          <tr>
            <th>参会角色</th>
            <th>嘉宾姓名</th>
            <th>省份/城市</th>
            <th>医院/科室</th>
            <th>职务</th>
            <th>提名理由</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => (
            <tr key={guest.id}>
              <td><Tag color={roleColor(guest.role)}>{guest.role || "其他嘉宾"}</Tag></td>
              <td><b>{guest.name || "待填写"}</b></td>
              <td>{[guest.province, guest.city].filter(Boolean).join(" / ") || "-"}</td>
              <td>{[guest.hospital, guest.department].filter(Boolean).join(" / ") || "-"}</td>
              <td>{guest.position || "-"}</td>
              <td>{guest.nominationReason || "-"}</td>
              <td>{guest.notes || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LabeledInput(props: { label: string; value: string; onChange: (value: string) => void; onBlur: () => void }) {
  return (
    <label className="field-chip">
      <span>{props.label}</span>
      <Input value={props.value} onChange={(event) => props.onChange(event.target.value)} onBlur={props.onBlur} />
    </label>
  );
}

function cascadeTimes(items: AgendaItem[], startIndex: number) {
  for (let index = startIndex; index < items.length; index += 1) {
    const previous = items[index - 1];
    items[index].start_time = previous.end_time;
    items[index].end_time = addMinutes(items[index].start_time, items[index].duration_minutes);
  }
  return items;
}

function toMeetingInput(values: Record<string, unknown>): MeetingInput {
  return {
    ...values,
    date: dayjs(values.date as dayjs.Dayjs).format("YYYY-MM-DD"),
    attendee_count: Number(values.attendee_count)
  } as MeetingInput;
}

function options(values: string[]) {
  return values.map((value) => ({ label: value, value }));
}

function guestStorageKey(meetingId: number) {
  return `academic-meeting-guests-${meetingId}`;
}

function deriveGuestsFromAgenda(items: AgendaItem[], existing: Guest[]) {
  const byName = new Map(existing.map((guest) => [guest.name, guest]));
  const collected = new Map<string, Guest>();
  const add = (rawNames: string, role: string, reason: string) => {
    splitNames(rawNames).forEach((name) => {
      const previous = collected.get(name) || byName.get(name);
      collected.set(name, {
        id: previous?.id || name,
        name,
        province: previous?.province || "",
        city: previous?.city || "",
        hospital: previous?.hospital || "",
        department: previous?.department || "",
        position: previous?.position || "",
        role: mergeRole(previous?.role, role),
        nominationReason: previous?.nominationReason || reason,
        notes: previous?.notes || ""
      });
    });
  };

  items.forEach((item) => {
    add(item.host, "主持人", `${item.section_name}主持`);
    add(item.speaker, "讲者", item.topic || `${item.section_name}讲者`);
    add(item.panelists, "讨论嘉宾", item.discussion_topic || `${item.section_name}讨论`);
  });
  existing.forEach((guest) => {
    if (guest.id.startsWith("guest-") && !collected.has(guest.name)) {
      collected.set(guest.name, guest);
    }
  });
  return Array.from(collected.values());
}

function splitNames(value: string) {
  return String(value || "")
    .replace(/、/g, ",")
    .replace(/；/g, ",")
    .replace(/;/g, ",")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function replaceGuestName(value: string, previousName: string, nextName: string) {
  if (!previousName) return value;
  return splitNames(value).map((name) => (name === previousName ? nextName : name)).filter(Boolean).join("、");
}

function removeGuestName(value: string, name: string) {
  return splitNames(value).filter((item) => item !== name).join("、");
}

function addGuestName(value: string, name: string) {
  const names = splitNames(value);
  if (!name || names.includes(name)) return value;
  return [...names, name].join("、");
}

function fieldsForGuestRole(role: string): Array<"host" | "speaker" | "panelists"> {
  const fields: Array<"host" | "speaker" | "panelists"> = [];
  if (role.includes("主持")) fields.push("host");
  if (role.includes("讲者") || role.includes("主席") || role.includes("特邀")) fields.push("speaker");
  if (role.includes("讨论")) fields.push("panelists");
  return fields.length ? fields : ["panelists"];
}

function mergeRole(current = "", next: string) {
  if (!current) return next;
  return current.split("/").includes(next) ? current : `${current}/${next}`;
}

function formatColor(format: string) {
  if (format.includes("报告")) return "blue";
  if (format.includes("讨论")) return "purple";
  if (format.includes("病例")) return "cyan";
  if (format.includes("茶歇")) return "orange";
  return "default";
}

function roleColor(role: string) {
  if (role.includes("主席")) return "gold";
  if (role.includes("主持")) return "blue";
  if (role.includes("讲者")) return "green";
  if (role.includes("讨论")) return "purple";
  if (role.includes("特邀")) return "cyan";
  return "default";
}

function getMeetingKeyPoints(meeting: Meeting | null, items: AgendaItem[]) {
  const reportTopics = items
    .filter((item) => item.section_name.includes("主题报告") || item.session_format.includes("报告"))
    .map((item) => item.topic)
    .filter(Boolean)
    .slice(0, 2);
  const hasDiscussion = items.some((item) => item.discussion_topic || item.section_name.includes("讨论"));
  const points = [
    meeting?.academic_field ? `${meeting.academic_field}精准诊疗` : "",
    ...reportTopics,
    hasDiscussion ? "专家讨论与共识输出" : ""
  ].filter(Boolean);
  return points.length > 0 ? points.join("；") : "待生成";
}

function buildOverviewText(planningNotes: string | undefined, keyPoints: string) {
  const notes = planningNotes?.trim() || "生成策划后展示会议设计思路。";
  if (notes.includes("会议要点")) return notes;
  return `策划说明：${notes}\n会议要点：${keyPoints}`;
}

function isTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(time: string) {
  if (!isTime(time)) return NaN;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesBetween(start: string, end: string) {
  return timeToMinutes(end) - timeToMinutes(start);
}

function addMinutes(time: string, minutes: number) {
  const base = timeToMinutes(time);
  if (Number.isNaN(base)) return time;
  const total = base + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function summarizeValidations(items: ValidationResult[]) {
  if (items.some((item) => item.severity === "error")) return { text: "需修改", color: "red", alertType: "error" as const };
  if (items.some((item) => item.severity === "warning")) return { text: "有提醒", color: "orange", alertType: "warning" as const };
  if (items.some((item) => item.severity === "ok")) return { text: "通过", color: "green", alertType: "success" as const };
  return { text: "未校验", color: "default", alertType: "info" as const };
}

export default App;
