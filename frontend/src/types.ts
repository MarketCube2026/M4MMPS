export interface MeetingInput {
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  level: string;
  format: string;
  academic_field: string;
  meeting_type: string;
  goal: string;
  audience: string;
  attendee_count: number;
}

export interface Meeting extends MeetingInput {
  id: number;
  theme: string;
  status: string;
  planning_notes: string;
  agenda_items: AgendaItem[];
  speaker_tasks: SpeakerTask[];
  validation_results: ValidationResult[];
}

export interface AgendaItem {
  id: number;
  meeting_id: number;
  sort_order: number;
  section_name: string;
  session_format: string;
  topic: string;
  host: string;
  speaker: string;
  panelists: string;
  discussion_topic: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  location: string;
  execution_notes: string;
}

export interface SpeakerTask {
  id: number;
  expert_name: string;
  role: string;
  task_description: string;
  time_range: string;
  notes: string;
}

export interface ValidationResult {
  id?: number;
  severity: "ok" | "warning" | "error";
  rule_code: string;
  message: string;
  agenda_item_id?: number;
}
