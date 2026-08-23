/**
 * homelab — Docker homelab service tool (project-local Pi extension).
 *
 * One `homelab` tool with a single `action` enum keeps the LLM-facing schema
 * compact and centralizes all validation and rendering here:
 *
 *   list     all containers (docker ps -a)
 *   status   global container status, or per-service compose ps
 *   logs     per-service log tail (truncated to 50KB / 2000 lines)
 *   up       ./manage-container.sh <svc> u   [p|b|pb]
 *   restart  ./manage-container.sh <svc> r   [p|b|pb]
 *   down     ./manage-container.sh <svc> d   (gated by permission-gate)
 *
 * up/restart/down wrap ./manage-container.sh instead of re-implementing it:
 * the script stays the single source of truth for stack actions (pull/build
 * policy, per-stack cleanup), so `homelab` behaves exactly like the `mc`
 * alias. Read-only actions (list/status/logs) call docker directly.
 *
 * All validation and command construction is exported as pure functions so
 * it can be unit-tested without Pi.
 */

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	withFileMutationQueue,
	type ExtensionAPI,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ─── Constants ───────────────────────────────────────────────────────────

export const DEFAULT_LOG_TAIL = 50;
export const MAX_LOG_TAIL = DEFAULT_MAX_LINES; // 2000
export const DEFAULT_TIMEOUT_MS = 120_000;
export const LONG_TIMEOUT_MS = 600_000;
export const PROGRESS_INTERVAL_MS = 5_000;
export const AUTO_DENY_TIMEOUT_MS = 60_000;
export const MANAGE_SCRIPT = "manage-container.sh";

export type HomelabAction = "status" | "list" | "logs" | "up" | "restart" | "down";
export type HomelabFlags = "p" | "b" | "pb";

const SERVICE_ACTIONS: HomelabAction[] = ["logs", "up", "restart", "down"];
const DOCKER_JSON_FORMAT = "json";

// ─── Base dir resolution (testable) ──────────────────────────────────────

/**
 * Resolve the homelab repo root: prefer the git toplevel of `startDir` when
 * it contains manage-container.sh, otherwise fall back to `startDir`.
 */
export function resolveBaseDir(startDir: string): string {
	try {
		const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: startDir,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		if (top && fs.existsSync(path.join(top, MANAGE_SCRIPT))) return top;
	} catch {
		// Not a git checkout or git missing — fall through.
	}
	return startDir;
}

// ─── Service discovery / validation (pure) ───────────────────────────────

/** Service names: top-level dirs under baseDir containing docker-compose.yml. */
export function listServices(baseDir: string): string[] {
	try {
		return fs
			.readdirSync(baseDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.filter((e) => fs.existsSync(path.join(baseDir, e.name, "docker-compose.yml")))
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

export type ServiceCheck =
	| { ok: true; name: string; dir: string }
	| { ok: false; error: string };

/** Validate that `service` is a top-level dir under baseDir with docker-compose.yml. */
export function checkService(baseDir: string, service: string): ServiceCheck {
	const name = (service ?? "").trim().replace(/\/+$/, "");
	if (!name || name.startsWith("-") || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
		return {
			ok: false,
			error: `Invalid service name "${service}". A service is a top-level directory under ${baseDir} containing a docker-compose.yml.`,
		};
	}
	const dir = path.join(baseDir, name);
	if (!fs.existsSync(path.join(dir, "docker-compose.yml"))) {
		const valid = listServices(baseDir);
		return {
			ok: false,
			error: `"${name}" is not a valid service (no ${path.join(name, "docker-compose.yml")}). Valid services: ${
				valid.length ? valid.join(", ") : "(none found)"
			}`,
		};
	}
	return { ok: true, name, dir };
}

// ─── Parameter validation (pure) ─────────────────────────────────────────

export type ParamsCheck =
	| { ok: true; action: HomelabAction; service?: string; flags?: HomelabFlags; tail: number }
	| { ok: false; error: string };

/** Cross-field validation. The JSON schema constrains types; this adds action/field rules. */
export function checkParams(action: HomelabAction, service?: string, flags?: HomelabFlags, tail?: number): ParamsCheck {
	const svc = service?.trim() || undefined;
	if (SERVICE_ACTIONS.includes(action) && !svc) {
		return { ok: false, error: `action "${action}" requires a service` };
	}
	if (flags && action !== "up" && action !== "restart") {
		return { ok: false, error: `flags (${flags}) are only valid for up/restart, not "${action}"` };
	}
	const t = tail ?? DEFAULT_LOG_TAIL;
	if (!Number.isInteger(t) || t < 1 || t > MAX_LOG_TAIL) {
		return { ok: false, error: `tail must be an integer between 1 and ${MAX_LOG_TAIL}` };
	}
	return { ok: true, action, service: svc, flags, tail: t };
}

// ─── Command construction (pure) ─────────────────────────────────────────

export interface HomelabCommand {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	/** Human-facing label used for progress updates and error messages. */
	progressLabel: string;
}

/** Build the exact command for an action. Caller must run checkParams/checkService first. */
export function buildCommand(
	baseDir: string,
	action: HomelabAction,
	service?: string,
	flags?: HomelabFlags,
	tail?: number,
): HomelabCommand {
	const composeFile = (s: string) => path.join(baseDir, s, "docker-compose.yml");
	const base = { cwd: baseDir, timeoutMs: DEFAULT_TIMEOUT_MS };

	switch (action) {
		case "list":
			return { command: "docker", args: ["ps", "-a", "--format", DOCKER_JSON_FORMAT], ...base, progressLabel: "Listing containers" };
		case "status":
			if (!service) {
				return { command: "docker", args: ["ps", "--format", DOCKER_JSON_FORMAT], ...base, progressLabel: "Collecting container status" };
			}
			return {
				command: "docker",
				args: ["compose", "-f", composeFile(service), "ps", "--format", "json"],
				...base,
				progressLabel: `Status for ${service}`,
			};
		case "logs":
			return {
				command: "docker",
				args: ["compose", "-f", composeFile(service!), "logs", "--tail", String(tail ?? DEFAULT_LOG_TAIL), "--no-color"],
				...base,
				progressLabel: `Reading logs for ${service}`,
			};
		case "up":
		case "restart": {
			const long = Boolean(flags);
			const label = long
				? `Pulling/building ${service}`
				: action === "up"
					? `Starting ${service}`
					: `Restarting ${service}`;
			return {
				command: `./${MANAGE_SCRIPT}`,
				args: [service!, action === "up" ? "u" : "r", ...(flags ? [flags] : [])],
				cwd: baseDir,
				timeoutMs: long ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
				progressLabel: label,
			};
		}
		case "down":
			return {
				command: `./${MANAGE_SCRIPT}`,
				args: [service!, "d"],
				...base,
				progressLabel: `Stopping ${service}`,
			};
	}
}

// ─── Execution (runner injected for testability) ─────────────────────────

export interface ExecRun {
	(
		command: string,
		args: string[],
		options: { signal?: AbortSignal; timeout?: number; cwd?: string },
	): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
}

export type ExecOutcome =
	| { ok: true; output: string }
	| { ok: false; error: string; output: string; timedOut: boolean };

/** Run a built command with timeout, abort support, and periodic progress ticks. */
export async function execHomelabCommand(
	run: ExecRun,
	cmd: HomelabCommand,
	signal: AbortSignal | undefined,
	onProgress?: (label: string, elapsedMs: number) => void,
): Promise<ExecOutcome> {
	const startedAt = Date.now();
	let tick: ReturnType<typeof setInterval> | undefined;
	if (onProgress) {
		tick = setInterval(() => onProgress(cmd.progressLabel, Date.now() - startedAt), PROGRESS_INTERVAL_MS);
	}
	try {
		const res = await run(cmd.command, cmd.args, { signal, timeout: cmd.timeoutMs, cwd: cmd.cwd });
		const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trimEnd();
		if (signal?.aborted) {
			return { ok: false, error: `${cmd.progressLabel} cancelled`, output, timedOut: false };
		}
		if (res.killed) {
			return {
				ok: false,
				error: `${cmd.progressLabel} timed out after ${Math.round(cmd.timeoutMs / 1000)}s`,
				output,
				timedOut: true,
			};
		}
		if (res.code !== 0) {
			return { ok: false, error: `${cmd.progressLabel} failed with exit code ${res.code}`, output, timedOut: false };
		}
		return { ok: true, output };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err), output: "", timedOut: false };
	} finally {
		if (tick) clearInterval(tick);
	}
}

// ─── Log truncation ──────────────────────────────────────────────────────

export interface LogDetails {
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	fullOutputPath?: string;
}

/**
 * Truncate log output to 50KB / 2000 lines (keep the tail). When truncated,
 * save the full output to a temp file so nothing is lost.
 */
export async function processLogOutput(fullOutput: string, service: string): Promise<{ text: string; details: LogDetails }> {
	const trunc: TruncationResult = truncateTail(fullOutput, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	const details: LogDetails = {
		truncated: trunc.truncated,
		truncatedBy: trunc.truncatedBy,
		totalLines: trunc.totalLines,
		totalBytes: trunc.totalBytes,
		outputLines: trunc.outputLines,
		outputBytes: trunc.outputBytes,
	};
	if (trunc.truncated) {
		const safe = service.replace(/[^a-zA-Z0-9_-]/g, "_");
		const dir = await mkdtemp(path.join(os.tmpdir(), "pi-homelab-logs-"));
		const file = path.join(dir, `logs-${safe}-${Date.now()}.txt`);
		await withFileMutationQueue(file, () => writeFile(file, fullOutput, "utf8"));
		details.fullOutputPath = file;
	}
	return { text: trunc.content, details };
}

// ─── Tool details (rendering payload) ────────────────────────────────────

export interface HomelabDetails {
	action: HomelabAction;
	service?: string;
	flags?: HomelabFlags;
	tail?: number;
	lineCount: number;
	durationMs: number;
	logs?: LogDetails;
	structured?: boolean;
}

interface ComposePsRow {
	Name?: string;
	Names?: string;
	Service?: string;
	State?: string;
	Status?: string;
	Health?: string;
	HealthStatus?: string;
	Ports?: string;
	RunningFor?: string;
	Image?: string;
	Labels?: string;
}

function truncateCell(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function parseJsonLines(output: string): ComposePsRow[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as ComposePsRow;
			} catch {
				return null;
			}
		})
		.filter((row): row is ComposePsRow => Boolean(row));
}

function labelValue(labels: string | undefined, key: string): string | undefined {
	if (!labels) return undefined;
	const prefix = `${key}=`;
	return labels.split(",").find((label) => label.startsWith(prefix))?.slice(prefix.length);
}

function health(row: ComposePsRow): string {
	const h = row.Health ?? row.HealthStatus;
	if (h && h !== "none") return h;
	const match = row.Status?.match(/\((healthy|unhealthy|starting)\)/i);
	return match?.[1] ?? "";
}

export function formatContainerRows(rows: ComposePsRow[], emptyMessage: string): string {
	if (rows.length === 0) return emptyMessage;

	const rendered = ["PROJECT        SERVICE          CONTAINER          STATE       HEALTH      STATUS                  PORTS"];
	for (const row of rows) {
		const project = truncateCell(labelValue(row.Labels, "com.docker.compose.project") ?? "-", 14).padEnd(14);
		const service = truncateCell(row.Service ?? labelValue(row.Labels, "com.docker.compose.service") ?? "-", 16).padEnd(16);
		const name = truncateCell(row.Name ?? row.Names ?? "?", 18).padEnd(18);
		const state = truncateCell(row.State ?? "?", 11).padEnd(11);
		const h = truncateCell(health(row), 10).padEnd(10);
		const status = truncateCell(row.Status ?? row.RunningFor ?? "", 22).padEnd(22);
		const ports = truncateCell((row.Ports ?? "").replaceAll("0.0.0.0:", "").replaceAll("[::]:", ""), 36);
		rendered.push(`${project} ${service} ${name} ${state} ${h} ${status} ${ports}`.trimEnd());
	}
	return rendered.join("\n");
}

export function formatComposeStatusJson(output: string): string {
	return formatContainerRows(parseJsonLines(output), "No compose containers found for this service.");
}

export function formatDockerPsJson(output: string, all: boolean): string {
	return formatContainerRows(parseJsonLines(output), all ? "No containers found." : "No running containers found.");
}

export interface HomelabInput {
	action: HomelabAction;
	service?: string;
	flags?: HomelabFlags;
	tail?: number;
}

export interface HomelabActionResult {
	text: string;
	details: HomelabDetails;
}

/** Execute a homelab action through the shared validator/runner path. */
export async function executeHomelabAction(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	params: HomelabInput,
	signal?: AbortSignal,
	onProgress?: (label: string, elapsedMs: number) => void,
): Promise<HomelabActionResult> {
	const checked = checkParams(params.action, params.service, params.flags, params.tail);
	if (!checked.ok) throw new Error(checked.error);

	const baseDir = resolveBaseDir(cwd);
	if (checked.service) {
		const svc = checkService(baseDir, checked.service);
		if (!svc.ok) throw new Error(svc.error);
	}
	if ((params.action === "up" || params.action === "restart" || params.action === "down") &&
		!fs.existsSync(path.join(baseDir, MANAGE_SCRIPT))) {
		throw new Error(`${MANAGE_SCRIPT} not found in ${baseDir} — cannot run ${params.action}`);
	}

	const cmd = buildCommand(baseDir, checked.action, checked.service, checked.flags, checked.tail);
	const startedAt = Date.now();
	const outcome = await execHomelabCommand((command, args, options) => pi.exec(command, args, options), cmd, signal, onProgress);
	if (!outcome.ok) throw new Error(outcome.error + (outcome.output ? `\n${outcome.output.slice(-4000)}` : ""));

	const durationMs = Date.now() - startedAt;
	let outputText = outcome.output;
	let logDetails: LogDetails | undefined;
	let structured = false;

	if (checked.action === "status" && checked.service) {
		outputText = formatComposeStatusJson(outcome.output);
		structured = true;
	} else if (checked.action === "status") {
		outputText = formatDockerPsJson(outcome.output, false);
		structured = true;
	} else if (checked.action === "list") {
		outputText = formatDockerPsJson(outcome.output, true);
		structured = true;
	} else if (checked.action === "logs") {
		const { text, details } = await processLogOutput(outcome.output, checked.service!);
		outputText = text;
		logDetails = details;
		if (details.truncated && details.fullOutputPath) {
			outputText += `\n\n[Showing the last ${details.outputLines} of ${details.totalLines} lines (${formatSize(details.totalBytes)}). Full output saved to: ${details.fullOutputPath}]`;
		}
	} else {
		const trunc = truncateTail(outputText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
		outputText = trunc.content;
	}

	if (!outputText.trim()) outputText = "(no output)";

	return {
		text: outputText,
		details: {
			action: checked.action,
			service: checked.service,
			flags: checked.flags,
			tail: checked.action === "logs" ? checked.tail : undefined,
			lineCount: outputText.split("\n").length,
			durationMs,
			logs: logDetails,
			structured,
		},
	};
}

export interface RenderableHomelabResult {
	content?: Array<{ type: string; text?: string }>;
	details?: HomelabDetails;
}

export function renderHomelabResult(
	result: RenderableHomelabResult,
	{ expanded, isPartial }: { expanded: boolean; isPartial: boolean },
	theme: { fg(color: string, text: string): string },
) {
	const details = result.details as HomelabDetails | undefined;

	if (isPartial) {
		const c = result.content?.[0];
		const t = c && c.type === "text" ? c.text ?? "Working…" : "Working…";
		return new Text(theme.fg("warning", t), 0, 0);
	}

	const c = result.content?.[0];
	const output = c && c.type === "text" ? c.text ?? "" : "";
	const lines = output ? output.split("\n") : [];

	let head: string;
	if (!details) {
		head = theme.fg("dim", output.slice(0, 300) || "(no output)");
	} else {
		const label = details.service ? `${details.action} ${details.service}` : details.action;
		const dur = `${(details.durationMs / 1000).toFixed(1)}s`;
		switch (details.action) {
			case "logs": {
				const log = details.logs;
				head = theme.fg("success", `${details.lineCount} log lines (${dur})`);
				if (log?.truncated) {
					head += theme.fg(
						"warning",
						` — showing last ${log.outputLines} of ${log.totalLines} (${formatSize(log.totalBytes)}${log.fullOutputPath ? ", full output saved" : ""})`,
					);
				}
				break;
			}
			case "up":
			case "restart":
			case "down":
				head = theme.fg("success", `${label}${details.flags ? ` ${details.flags}` : ""} — ${dur}`);
				break;
			default:
				head = theme.fg("success", `${label} — ${dur}`);
		}
	}

	if (expanded && output) {
		const shown = lines.slice(0, 25);
		for (const line of shown) head += `\n${theme.fg("dim", line)}`;
		if (lines.length > 25) head += `\n${theme.fg("muted", `… ${lines.length - 25} more lines`)}`;
		if (details?.logs?.fullOutputPath) head += `\n${theme.fg("dim", `Full logs: ${details.logs.fullOutputPath}`)}`;
		if (details) head += `\n${theme.fg("muted", "(Ctrl+O to collapse)")}`;
	} else if (output && details?.action === "logs") {
		const compactLines = lines.filter((line) => line.trim());
		const preview = compactLines.slice(-8);
		for (const line of preview) head += `\n${theme.fg("dim", line)}`;
		if (compactLines.length > preview.length) head += `\n${theme.fg("muted", `… ${compactLines.length - preview.length} earlier lines`)}`;
		head += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	} else if (output && (details?.action === "status" || details?.action === "list")) {
		const compactLines = lines.filter((line) => line.trim());
		const preview = compactLines.slice(0, 12);
		for (const line of preview) head += `\n${theme.fg("dim", line)}`;
		if (compactLines.length > preview.length) head += `\n${theme.fg("muted", `… ${compactLines.length - preview.length} more lines`)}`;
		head += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	} else {
		head += ` ${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}

	return new Text(head, 0, 0);
}

// ─── Tool registration ───────────────────────────────────────────────────

export function registerHomelabTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "homelab",
		label: "Homelab",
		description:
			"Manage Docker services on this homelab server. Actions: list (all containers), status (global or one service), logs (service log tail), up (start, optional pull/build flags), restart, down (stop & remove, requires confirmation).",
		promptSnippet: "Docker homelab service management: list, status, logs, up, restart, down",
		promptGuidelines: [
			"Use homelab for Docker service operations in this repo instead of running docker or manage-container.sh via bash.",
			"Use homelab list to discover valid service names before calling homelab status/logs/up/restart/down.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "list", "logs", "up", "restart", "down"] as const, {
				description: "Operation to perform",
			}),
			service: Type.Optional(
				Type.String({
					description:
						"Service directory name (e.g. 'caddy'). Required for logs/up/restart/down; optional for status (omit for global status).",
				}),
			),
			flags: Type.Optional(
				StringEnum(["p", "b", "pb"] as const, {
					description: "up/restart only: p = pull images, b = build, pb = both",
				}),
			),
			tail: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: MAX_LOG_TAIL,
					description: `logs only: number of log lines (default ${DEFAULT_LOG_TAIL})`,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const result = await executeHomelabAction(
				pi,
				ctx.cwd,
				params,
				signal,
				(label, elapsedMs) => {
					onUpdate?.({
						content: [{ type: "text", text: `${label}… (${Math.round(elapsedMs / 1000)}s elapsed)` }],
					});
				},
			);
			return { content: [{ type: "text", text: result.text }], details: result.details };
		},

		// ── Rendering ──

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("homelab "));
			text += theme.fg("accent", args.action);
			if (args.service) text += ` ${theme.fg("muted", args.service)}`;
			if (args.flags) text += theme.fg("dim", ` ${args.flags}`);
			if (args.action === "logs" && args.tail) text += theme.fg("dim", ` tail=${args.tail}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			return renderHomelabResult(result, { expanded, isPartial }, theme);
		},
	});
}
