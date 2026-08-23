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

async function serviceSummary(pi: ExtensionAPI, baseDir: string, service: string): Promise<string> {
	const checked = checkService(baseDir, service);
	if (!checked.ok) return "invalid";
	const compose = `${baseDir}/${service}/docker-compose.yml`;
	try {
		const res = await pi.exec("docker", ["compose", "-f", compose, "ps", "--format", "json"], { cwd: baseDir, timeout: 10_000 });
		if (res.code !== 0 || !res.stdout.trim()) return "stopped / no containers";
		const lines = res.stdout.trim().split("\n").filter(Boolean);
		const running = lines.filter((line) => /running|healthy|up/i.test(line)).length;
		const unhealthy = lines.filter((line) => /unhealthy|restart|exited|dead/i.test(line)).length;
		if (unhealthy > 0) return `${lines.length} containers, attention`;
		if (running > 0) return `${running}/${lines.length} running`;
		return `${lines.length} containers`;
	} catch {
		return "status unavailable";
	}
}

async function buildServiceRows(pi: ExtensionAPI, baseDir: string): Promise<ServiceRow[]> {
	const services = listServices(baseDir);
	return Promise.all(
		services.map(async (service) => {
			const summary = await serviceSummary(pi, baseDir, service);
			return { name: service, label: `${service.padEnd(24)} ${summary}` };
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
		const choice = await ctx.ui.select("Homelab Services", [...labels, "Refresh", "Quit"]);
		if (!choice || choice === "Quit") return;
		if (choice === "Refresh") continue;

		const row = rows.find((candidate) => candidate.label === choice);
		if (!row) continue;
		const next = await serviceActionLoop(pi, ctx, row.name, runAction);
		if (next === "quit") return;
		if (next === "refresh") continue;
	}
}
