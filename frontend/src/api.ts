import type { AgendaItem, Meeting, MeetingInput } from "./types";

const jsonHeaders = { "Content-Type": "application/json" };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listMeetings: () => request<Meeting[]>("/api/meetings"),
  createMeeting: (payload: MeetingInput) =>
    request<Meeting>("/api/meetings", { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateMeeting: (id: number, payload: MeetingInput & { theme: string; planning_notes: string; status: string }) =>
    request<Meeting>(`/api/meetings/${id}`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify(payload) }),
  generate: (id: number) => request<Meeting>(`/api/meetings/${id}/generate`, { method: "POST" }),
  updateAgendaItem: (item: AgendaItem) =>
    request<AgendaItem>(`/api/agenda-items/${item.id}`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify(item) }),
  createAgendaItem: (meetingId: number, item: Omit<AgendaItem, "id" | "meeting_id">) =>
    request<AgendaItem>(`/api/meetings/${meetingId}/agenda-items`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(item)
    }),
  deleteAgendaItem: (id: number) => request<{ deleted: boolean }>(`/api/agenda-items/${id}`, { method: "DELETE" }),
  reorder: (meetingId: number, itemIds: number[]) =>
    request<Meeting>(`/api/meetings/${meetingId}/agenda-items/reorder`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ item_ids: itemIds })
    }),
  recalculate: (meetingId: number) =>
    request<Meeting>(`/api/meetings/${meetingId}/agenda-items/recalculate-time`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({})
    }),
  validate: (meetingId: number) =>
    request<{ validation_results: Meeting["validation_results"] }>(`/api/meetings/${meetingId}/validate`, { method: "POST" })
};
