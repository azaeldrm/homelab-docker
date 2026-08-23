/** Menu-driven /homelab dashboard using Pi's built-in select UI. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	checkService,
	DEFAULT_LOG_TAIL,
	executeHomelabAction,
	listServices,
	resolveBaseDir,
	type HomelabAction,
	type HomelabFlags,
} from "./tools.ts";

interface ServiceRow {
	name: string;
	label: string;
}

interface ComposeStatusRow {
	State?: string;
	Status?: string;
	Health?: string;
	HealthStatus?: string;
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function parseComposeRows(output: string): ComposeStatusRow[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as ComposeStatusRow;
			} catch {
				return null;
			}
		})
		.filter((row): row is ComposeStatusRow => Boolean(row));
}

function rowHealth(row: ComposeStatusRow): string {
	const explicit = row.Health ?? row.HealthStatus;
	if (explicit && explicit !== "none") return explicit;
	return row.Status?.match(/\((healthy|unhealthy|starting)\)/i)?.[1] ?? "";
}

function summarizeRows(rows: ComposeStatusRow[]): { icon: string; count: string; state: string; status: string } {
	if (rows.length === 0) return { icon: "○", count: "0/0", state: "down", status: "no containers" };
	const running = rows.filter((row) => /running/i.test(row.State ?? "") || /\bUp\b/i.test(row.Status ?? "")).length;
	const attention = rows.some((row) => /unhealthy|restart|exited|dead|error/i.test(`${row.State ?? ""} ${row.Status ?? ""} ${rowHealth(row)}`));
	const starting = rows.some((row) => /starting|created|paused/i.test(`${row.State ?? ""} ${row.Status ?? ""} ${rowHealth(row)}`));
	const firstStatus = rows.find((row) => row.Status)?.Status ?? rows[0]?.State ?? "unknown";
	if (attention) return { icon: "✗", count: `${running}/${rows.length}`, state: "attention", status: firstStatus };
	if (starting) return { icon: "!", count: `${running}/${rows.length}`, state: "starting", status: firstStatus };
	if (running === rows.length) return { icon: "✓", count: `${running}/${rows.length}`, state: "running", status: firstStatus };
	if (running > 0) return { icon: "!", count: `${running}/${rows.length}`, state: "partial", status: firstStatus };
	return { icon: "○", count: `${running}/${rows.length}`, state: "stopped", status: firstStatus };
}

async function serviceSummary(pi: ExtensionAPI, baseDir: string, service: string): Promise<{ icon: string; count: string; state: string; status: string }> {
	const checked = checkService(baseDir, service);
	if (!checked.ok) return { icon: "?", count: "?", state: "invalid", status: "missing compose" };
	const compose = `${baseDir}/${service}/docker-compose.yml`;
	try {
		const res = await pi.exec("docker", ["compose", "-f", compose, "ps", "--format", "json"], { cwd: baseDir, timeout: 10_000 });
		if (res.code !== 0 || !res.stdout.trim()) return { icon: "○", count: "0/0", state: "down", status: "no containers" };
		return summarizeRows(parseComposeRows(res.stdout));
	} catch {
		return { icon: "?", count: "?", state: "unknown", status: "status unavailable" };
	}
}

async function buildServiceRows(pi: ExtensionAPI, baseDir: string): Promise<ServiceRow[]> {
	const services = listServices(baseDir);
	return Promise.all(
		services.map(async (service) => {
			const summary = await serviceSummary(pi, baseDir, service);
			const label = `${summary.icon} ${truncate(service, 24).padEnd(24)} ${summary.count.padEnd(5)} ${summary.state.padEnd(10)} ${truncate(summary.status, 36)}`;
			return { name: service, label };
		}),
	);
}

function parseAction(choice: string): { action: HomelabAction; tail?: number; flags?: HomelabFlags } | null {
	switch (choice) {
		case `Logs (tail ${DEFAULT_LOG_TAIL})`:
			return { action: "logs", tail: DEFAULT_LOG_TAIL };
		case "Logs (tail 200)":
			return { action: "logs", tail: 200 };
		case "Up":
			return { action: "up" };
		case "Restart":
			return { action: "restart" };
		case "Down / stop service":
			return { action: "down" };
		default:
			return null;
	}
}

export interface DashboardActionRunner {
	(command: string, params: { action: HomelabAction; service?: string; flags?: HomelabFlags; tail?: number }): Promise<void>;
}

async function selectedServiceStatus(pi: ExtensionAPI, ctx: ExtensionContext, service: string): Promise<string> {
	try {
		const result = await executeHomelabAction(pi, ctx.cwd, { action: "status", service });
		return result.text;
	} catch (err) {
		return `Status unavailable: ${err instanceof Error ? err.message : String(err)}`;
	}
}

async function serviceActionLoop(pi: ExtensionAPI, ctx: ExtensionContext, service: string, runAction: DashboardActionRunner): Promise<"back" | "refresh" | "quit"> {
	while (true) {
		const status = await selectedServiceStatus(pi, ctx, service);
		const choice = await ctx.ui.select(`${service} — current status\n\n${status}\n\nChoose action`, [
			`Logs (tail ${DEFAULT_LOG_TAIL})`,
			"Logs (tail 200)",
			"Up",
			"Restart",
			"Down / stop service",
			"Back",
			"Refresh",
			"Quit",
		]);
		if (!choice || choice === "Back") return "back";
		if (choice === "Refresh") return "refresh";
		if (choice === "Quit") return "quit";

		const action = parseAction(choice);
		if (!action) continue;
		await runAction(`homelab ${action.action} ${service}${action.tail ? ` ${action.tail}` : ""}`, {
			action: action.action,
			service,
			flags: action.flags,
			tail: action.tail,
		});
	}
}

export async function runHomelabDashboard(pi: ExtensionAPI, ctx: ExtensionContext, runAction: DashboardActionRunner): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/homelab dashboard requires an interactive UI. Use /homelab list in headless contexts.", "error");
		return;
	}

	const baseDir = resolveBaseDir(ctx.cwd);
	while (true) {
		const rows = await buildServiceRows(pi, baseDir);
		const labels = rows.map((row) => row.label);
		const title = [
			"Homelab Services",
			"",
			"  SERVICE                  CNT   STATE      STATUS",
			"  ─────────────────────────────────────────────────────────────",
		].join("\n");
		const choice = await ctx.ui.select(title, [...labels, "Refresh", "Quit"]);
		if (!choice || choice === "Quit") return;
		if (choice === "Refresh") continue;

		const row = rows.find((candidate) => candidate.label === choice);
		if (!row) continue;
		const next = await serviceActionLoop(pi, ctx, row.name, runAction);
		if (next === "quit") return;
		if (next === "refresh") continue;
	}
}
