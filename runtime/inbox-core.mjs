//#region src/types.ts
var BOARD_DEFINITIONS = [
	{
		key: "bugs",
		label: "Bugs and Errors",
		shortLabel: "Bugs"
	},
	{
		key: "aiTodo",
		label: "AI Todo",
		shortLabel: "AI Todo"
	},
	{
		key: "myTodo",
		label: "My Todo",
		shortLabel: "My Todo"
	},
	{
		key: "ideas",
		label: "Ideas and Backlog",
		shortLabel: "Ideas"
	},
	{
		key: "playtest",
		label: "Playtest Feedback",
		shortLabel: "Playtest"
	},
	{
		key: "assets",
		label: "Assets Needed",
		shortLabel: "Assets"
	}
];
//#endregion
//#region src/lib/ids.ts
function createId(prefix) {
	return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
//#endregion
//#region src/lib/priority.ts
var DEFAULT_ESCALATION = {
	lowToMediumDays: 7,
	mediumToHighDays: 5,
	highToUrgentDays: 3
};
//#endregion
//#region src/seed.ts
function createProject(name, color, icon, now = (/* @__PURE__ */ new Date()).toISOString()) {
	return {
		id: createId("project"),
		name,
		color,
		icon,
		stage: "prototype",
		settings: {
			escalation: { ...DEFAULT_ESCALATION },
			defaultBoard: "myTodo",
			collapsedBoards: {}
		},
		createdAt: now,
		updatedAt: now
	};
}
function createTask(input, now = (/* @__PURE__ */ new Date()).toISOString()) {
	return {
		id: createId("task"),
		projectId: input.projectId,
		board: input.board,
		title: input.title,
		kind: input.kind ?? "checkbox",
		startingPriority: input.priority ?? "medium",
		dueAt: input.dueAt,
		scheduledAt: input.scheduledAt,
		deadlineId: input.deadlineId,
		sourceNoteId: input.sourceNoteId,
		color: input.color,
		subtasks: [],
		createdAt: now,
		updatedAt: now,
		touchedAt: now,
		rescheduleLog: []
	};
}
//#endregion
//#region shared/coordination.mjs
var progressStates = [
	"unknown",
	"in-progress",
	"waiting-on-me",
	"waiting-on-agent",
	"paused",
	"blocked",
	"done"
];
var idOkay = (value) => typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
function text(value, max = 2e3) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function iso(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function parseCoordination(value) {
	if (!value || value.version !== 1 || !idOkay(value.id) || !iso(value.at)) throw new Error("Invalid coordination id, version, or timestamp.");
	if (value.format === "forgeboard-project") {
		if (!text(value.project, 500) || value.color !== void 0 && !/^#[0-9a-f]{6}$/i.test(value.color) || value.icon !== void 0 && !text(value.icon, 16)) throw new Error("Invalid project registration.");
		return value;
	}
	if (value.format === "forgeboard-relay-result") {
		if (!idOkay(value.handoffId) || ![
			"claimed",
			"delivered",
			"failed",
			"needs-check"
		].includes(value.state) || !text(value.detail)) throw new Error("Invalid relay receipt.");
		return value;
	}
	if (value.format !== "forgeboard-status" || !text(value.project, 500) || !value.chat || !idOkay(value.chat.id) || !text(value.chat.name, 500) || ![
		"codex",
		"claude-code",
		"claude",
		"chatgpt",
		"other"
	].includes(value.chat.agent) || !progressStates.includes(value.status) || !text(value.summary, 4e3)) throw new Error("Invalid chat status event.");
	if (value.nextAction !== void 0 && !text(value.nextAction, 4e3)) throw new Error("Invalid next action.");
	if (value.chat.source !== void 0 && !text(value.chat.source, 4e3)) throw new Error("Invalid source.");
	if (value.handoff) {
		const h = value.handoff;
		if (!idOkay(h.toChatId) || !idOkay(h.chainId) || !Number.isInteger(h.hop) || h.hop < 0 || h.hop > 100 || !text(h.instruction, 4e3)) throw new Error("Invalid handoff destination or chain.");
		if (!["done", "waiting-on-agent"].includes(value.status)) throw new Error("Only completed agent work can request a peer handoff.");
		if (!Array.isArray(h.files) || h.files.length > 8 || h.files.some((file) => typeof file !== "string" || file.length > 250 || !file.endsWith(".md") || file.startsWith("/") || file.includes("\\") || file.split("/").some((part) => !part || part === ".." || part === ".") || /^[a-z]:/i.test(file))) throw new Error("Handoff files must be relative Markdown paths inside the project.");
	}
	return value;
}
//#endregion
//#region src/lib/coordination.ts
function resolveProject(workspace, name, now) {
	const exact = workspace.projects.find((item) => !item.deletedAt && item.id === name);
	if (exact) return exact;
	const matches = workspace.projects.filter((item) => !item.deletedAt && item.name.toLowerCase() === name.trim().toLowerCase());
	if (matches.length > 1) throw new Error("Ambiguous project. Use its exact id.");
	if (matches[0]) return matches[0];
	const project = createProject(name.trim(), "#7c9cff", "📁", now);
	project.id = `inbox-project:${encodeURIComponent(name.trim().toLowerCase())}`;
	if (workspace.projects.some((item) => item.id === project.id)) throw new Error("This project was deleted. Restore it before submitting new updates.");
	workspace.projects.push(project);
	return project;
}
function applyCoordination(workspace, event, now) {
	if (Date.parse(event.at) > Date.parse(now) + 3e5) throw new Error("Update timestamp is in the future.");
	if (event.format === "forgeboard-project") {
		const count = workspace.projects.length;
		const project = resolveProject(workspace, event.project, now);
		if (workspace.projects.length === count) return false;
		Object.assign(project, {
			color: event.color ?? project.color,
			icon: event.icon ?? project.icon,
			workState: "unknown"
		});
	} else if (event.format === "forgeboard-relay-result") {
		workspace.relayReceipts ??= [];
		const old = workspace.relayReceipts.findIndex((item) => item.id === event.id);
		if (old >= 0 && Date.parse(workspace.relayReceipts[old].at) >= Date.parse(event.at)) return false;
		if (old < 0) workspace.relayReceipts.push(event);
		else workspace.relayReceipts[old] = event;
	} else {
		workspace.agentEvents ??= [];
		if (workspace.agentEvents.some((item) => item.id === event.id)) return false;
		const project = resolveProject(workspace, event.project, now);
		workspace.agentChats ??= [];
		const old = workspace.agentChats.find((item) => item.id === event.chat.id);
		if (old && old.projectId !== project.id) throw new Error("Chat id belongs to another project. Use a unique chat id.");
		workspace.agentEvents.push(event);
		if (!old || Date.parse(old.updatedAt) < Date.parse(event.at)) {
			const chat = {
				id: event.chat.id,
				projectId: project.id,
				name: event.chat.name,
				agent: event.chat.agent,
				status: event.status,
				summary: event.summary,
				nextAction: event.nextAction,
				source: event.chat.source,
				updatedAt: event.at,
				paused: old?.paused
			};
			if (old) Object.assign(old, chat);
			else workspace.agentChats.push(chat);
		}
	}
	workspace.updatedAt = now;
	return true;
}
//#endregion
//#region src/lib/taskInbox.ts
function parseSubmission(text) {
	if (new TextEncoder().encode(text).length > 2e5) throw new Error("File exceeds 200 KB.");
	const value = JSON.parse(text);
	if (!value || value.format !== "forgeboard-task" || value.version !== 1) throw new Error("Expected forgeboard-task version 1.");
	for (const key of [
		"id",
		"project",
		"date",
		"summary"
	]) if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 500) throw new Error(`Invalid ${key}.`);
	if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value.id)) throw new Error("Use a stable id with letters, numbers, dots, underscores or dashes.");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || (/* @__PURE__ */ new Date(`${value.date}T00:00:00Z`)).toISOString().slice(0, 10) !== value.date) throw new Error("Invalid calendar date.");
	if (value.board && !BOARD_DEFINITIONS.some((board) => board.key === value.board)) throw new Error("Unknown board.");
	if (value.priority && ![
		"low",
		"medium",
		"high"
	].includes(value.priority)) throw new Error("Unknown priority.");
	if (value.notes !== void 0 && (typeof value.notes !== "string" || value.notes.length > 2e4)) throw new Error("Invalid notes.");
	if (value.reviewAt !== void 0 && (typeof value.reviewAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.reviewAt) || !Number.isFinite(Date.parse(value.reviewAt)))) throw new Error("reviewAt needs a date and time with a timezone.");
	if (value.estimateMinutes !== void 0 && (!Number.isInteger(value.estimateMinutes) || value.estimateMinutes < 1 || value.estimateMinutes > 480)) throw new Error("Estimate must be 1–480 minutes.");
	if (value.handoff !== void 0) {
		const handoff = value.handoff;
		if (!handoff || ![
			"codex",
			"claude-code",
			"claude",
			"chatgpt",
			"other"
		].includes(handoff.agent)) throw new Error("Invalid handoff agent.");
		if (typeof handoff.review !== "string" || !handoff.review.trim() || handoff.review.length > 4e3) throw new Error("Explain what the human should review.");
		if (!Array.isArray(handoff.completedWork) || handoff.completedWork.length > 50 || handoff.completedWork.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 1e3)) throw new Error("Invalid completed work.");
		for (const key of [
			"source",
			"resume",
			"relatedSubmissionId"
		]) if (handoff[key] !== void 0 && (typeof handoff[key] !== "string" || handoff[key].length > 4e3)) throw new Error(`Invalid handoff ${key}.`);
	}
	if (!Array.isArray(value.subtasks) || !value.subtasks.length || value.subtasks.length > 200) throw new Error("Include 1–200 subtasks.");
	const ids = /* @__PURE__ */ new Set();
	for (const step of value.subtasks) {
		if (!step || typeof step.id !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(step.id) || ids.has(step.id)) throw new Error("Subtask ids must be unique.");
		if (typeof step.title !== "string" || !step.title.trim() || step.title.length > 1e3) throw new Error("Invalid subtask title.");
		ids.add(step.id);
	}
	return value;
}
function importSubmissions(workspace, files, now) {
	const next = structuredClone(workspace);
	const errors = [];
	let added = 0;
	let updates = 0;
	for (const file of files) try {
		if (new TextEncoder().encode(file.text).length > 2e5) throw new Error("File exceeds 200 KB.");
		const raw = JSON.parse(file.text);
		if ([
			"forgeboard-status",
			"forgeboard-relay-result",
			"forgeboard-project"
		].includes(raw?.format)) {
			const candidate = structuredClone(next);
			if (applyCoordination(candidate, parseCoordination(raw), now)) {
				Object.assign(next, candidate);
				updates++;
			}
			continue;
		}
		const submission = parseSubmission(file.text);
		const id = `submission:${submission.id}`;
		if (next.tasks.some((task) => task.id === id)) continue;
		const projectName = submission.project.trim();
		const matches = next.projects.filter((item) => !item.deletedAt && item.name.toLowerCase() === projectName.toLowerCase());
		let project = next.projects.find((item) => !item.deletedAt && item.id === projectName);
		if (!project && matches.length > 1) throw new Error("Project name is ambiguous. Use its exact project id.");
		project ??= matches[0];
		if (!project) {
			project = createProject(projectName, "#7c9cff", "🎮", now);
			project.id = `inbox-project:${encodeURIComponent(projectName.toLowerCase())}`;
			if (next.projects.some((item) => item.id === project.id)) throw new Error("This project was deleted; restore it or use a new project name.");
			next.projects.push(project);
		}
		const task = createTask({
			projectId: project.id,
			board: submission.board ?? "myTodo",
			title: `${submission.date} · ${submission.summary.trim()}`,
			priority: submission.priority ?? "medium"
		}, now);
		task.id = id;
		task.notes = submission.notes;
		task.submission = {
			id: submission.id,
			date: submission.date,
			sourceFile: file.path
		};
		task.handoff = submission.handoff;
		task.workStatus = "needs-review";
		task.reviewAt = submission.reviewAt;
		task.estimateMinutes = submission.estimateMinutes;
		task.subtasks = submission.subtasks.map((step) => ({
			id: `${id}:${step.id}`,
			title: step.title.trim(),
			createdAt: now,
			updatedAt: now
		}));
		next.tasks.push(task);
		next.activity.push({
			id: `event:${id}`,
			type: "created",
			at: now,
			projectId: project.id,
			taskId: id,
			title: task.title,
			details: `Imported ${file.path}`
		});
		added++;
	} catch (error) {
		errors.push(`${file.path}: ${error instanceof Error ? error.message : "Invalid file."}`);
	}
	if (added) next.updatedAt = now;
	return {
		workspace: next,
		added,
		updates,
		errors
	};
}
//#endregion
export { importSubmissions, parseCoordination, parseSubmission };
