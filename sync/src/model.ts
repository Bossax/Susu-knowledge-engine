export const states = ["Backlog", "Not Started", "In Progress", "Blocked", "Done"] as const;
export type State = typeof states[number];
export type Thread = { id: string; title: string; status: "active" | "dormant" | "done"; path: string; project?: string; tags: string[]; body?: string; createdBy?: string; createdOn?: string };
export type Task = { id: string; pageId: string; title: string; status: State; thread?: string; deadline?: string; edited: string };
export type Artifact = { id: string; title: string; kind: "proposal" | "decision"; path: string; body?: string };
export type TaskEvent = { taskId: string; state: State; author: string; createdOn: string; recordedBy: string; expectedStatus: State; expectedEdited: string; evidence: string[] };
export type Inventory = { threads: Thread[]; artifacts: Artifact[]; events: TaskEvent[]; warnings: string[] };
export type Config = { repository: string; branch: string; notion: {version: string; workspaceId?: string; threads: string; tasks: string; activity: string; dashboardBlock: string} };
export function validDate(value: string): boolean { return Number.isFinite(Date.parse(value)); }
export function validateEvent(e: TaskEvent): void {
  if (!e || !/^TASK-[a-zA-Z0-9-]+$/.test(e.taskId) ||
      !states.includes(e.state) || !states.includes(e.expectedStatus) ||
      typeof e.author !== "string" || !e.author.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(e.createdOn) ||
      typeof e.recordedBy !== "string" || !e.recordedBy.trim() || !validDate(e.expectedEdited) ||
      !Array.isArray(e.evidence) || e.evidence.length === 0 || e.evidence.some(x => typeof x !== "string" || !x.trim())) {
    throw new Error("Invalid task event: use the documented task-event template");
  }
}
export function priority(threads: Thread[], tasks: Task[]) {
  const eligible = threads.filter(t => t.status === "active").map(thread => {
    const open = tasks.filter(t => t.thread === thread.id && t.status !== "Done");
    const dates = open.flatMap(t => t.deadline && validDate(t.deadline) ? [t.deadline] : []).sort((a,b) => Date.parse(a)-Date.parse(b));
    return {thread, deadline: dates[0], open: open.length};
  }).filter(x => x.open);
  const byId = (a: typeof eligible[number], b: typeof eligible[number]) => a.thread.id.localeCompare(b.thread.id, "en");
  const dated = eligible.filter(x => x.deadline).sort((a,b) => Date.parse(a.deadline!)-Date.parse(b.deadline!) || byId(a,b));
  const free = eligible.filter(x => !x.deadline).sort(byId);
  return {slots: [dated[0] ?? null, dated[1] ?? null, free[0] ?? null],
    ties: dated.filter((x,i) => dated.some((y,j) => i !== j && Date.parse(y.deadline!) === Date.parse(x.deadline!))).map(x => x.thread.id)};
}
export function reconcile(events: TaskEvent[], tasks: Task[]) {
  const tracked = new Set(events.map(e => e.taskId));
  return [...events.map(event => {
    const matches = tasks.filter(t => t.id === event.taskId);
    if (matches.length !== 1) return {task: event.taskId, state:"unverified", reason:"Missing or duplicate Notion task"};
    const task = matches[0];
    if (task.status === event.state) return {task: event.taskId, state:"aligned", reason:"Notion already reflects the requested state"};
    if (task.edited === event.expectedEdited && task.status === event.expectedStatus)
      return {task: event.taskId, state:"pending", reason:"Notion still matches the explicitly observed snapshot"};
    return {task: event.taskId, state:"unverified", reason:"Notion changed since observation; chronological authority cannot be inferred from commit dates"};
  }), ...tasks.filter(t => !tracked.has(t.id)).map(t => ({task: t.id, state:"untracked",
    reason: "No task-events file: see task-events template for explicit task-state events"}))];
}
