/**
 * /homelab slash command for direct operator control.
 *
 * This command intentionally reuses the M2 homelab tool primitives from
 * tools.ts so the LLM-facing tool and user-facing command do not drift.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import {
	AUTO_DENY_TIMEOUT_MS,
	DEFAULT_LOG_TAIL,
	executeHomelabAction,
	listServices,
	renderHomelabResult,
	resolveBaseDir,
	type HomelabAction,
	type HomelabDetails,
	type HomelabFlags,
} from "./tools.ts";
import { runHomelabDashboard } from "./dashboard.ts";

export const HOMELAB_ENTRY_TYPE = "homelab-command";

export interface HomelabCommandEntry {
	command: string;
	text: string;
	details: HomelabDetails;
}

export type HomelabCommandParseResult =
	| { ok: true; dashboard: true }
	| { ok: true; dashboard: false; action: HomelabAction; service?: string; flags?: HomelabFlags; tail?: number }
	| { ok: false; error: string };

const HELP = [
	"Usage:",
	"  /homelab",
	"  /homelab list",
	"  /homelab status [service]",
	"  /homelab logs <service> [tail]",
	"  /homelab up <service> [p|b|pb]",
	"  /homelab restart <service> [p|b|pb]",
	"  /homelab down <service>",
].join("\n");

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(input))) tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
	return tokens;
}

export function parseHomelabCommand(args: string): HomelabCommandParseResult {
	const tokens = tokenize(args.trim());
	if (tokens.length === 0) return { ok: true, dashboard: true };

	const [rawAction, rawService, rawThird, ...rest] = tokens;
	const action = rawAction as HomelabAction;
	if (!action || !["list", "status", "logs", "up", "restart", "down"].includes(action)) {
		return { ok: false, error: `Unknown /homelab subcommand: ${rawAction ?? ""}\n\n${HELP}` };
	}
	if (rest.length > 0) return { ok: false, error: `Too many arguments for /homelab ${action}.\n\n${HELP}` };

	switch (action) {
		case "list":
			if (rawService) return { ok: false, error: `/homelab list does not take a service.\n\n${HELP}` };
			return { ok: true, dashboard: false, action };
		case "status":
			if (rawThird) return { ok: false, error: `/homelab status accepts at most one service.\n\n${HELP}` };
			return { ok: true, dashboard: false, action, service: rawService };
		case "logs": {
			if (!rawService) return { ok: false, error: `/homelab logs requires a service.\n\n${HELP}` };
			let tail = DEFAULT_LOG_TAIL;
			if (rawThird !== undefined) {
				tail = Number(rawThird);
				if (!Number.isInteger(tail) || tail < 1) return { ok: false, error: `Invalid log tail: ${rawThird}. Use a positive integer.` };
			}
			return { ok: true, dashboard: false, action, service: rawService, tail };
		}
		case "up":
		case "restart": {
			if (!rawService) return { ok: false, error: `/homelab ${action} requires a service.\n\n${HELP}` };
			if (rawThird !== undefined && !["p", "b", "pb"].includes(rawThird)) {
				return { ok: false, error: `Invalid flags: ${rawThird}. Use p, b, or pb.` };
			}
			return { ok: true, dashboard: false, action, service: rawService, flags: rawThird as HomelabFlags | undefined };
		}
		case "down":
			if (!rawService) return { ok: false, error: `/homelab down requires a service.\n\n${HELP}` };
			if (rawThird) return { ok: false, error: `/homelab down does not accept flags.\n\n${HELP}` };
			return { ok: true, dashboard: false, action, service: rawService };
	}
}

export async function confirmHomelabDown(ctx: ExtensionContext, service: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	const choice = await ctx.ui.select(
		`⚠️ Stop/remove ${service} containers?\n\nThis runs: ./manage-container.sh ${service} d\n\nTimeout auto-selects No in ${AUTO_DENY_TIMEOUT_MS / 1000}s.`,
		["No", "Yes"],
		{ timeout: AUTO_DENY_TIMEOUT_MS },
	);
	return choice === "Yes";
}

export async function appendHomelabCommandResult(
	pi: ExtensionAPI,
	command: string,
	text: string,
	details: HomelabDetails,
) {
	pi.appendEntry<HomelabCommandEntry>(HOMELAB_ENTRY_TYPE, { command, text, details });
}

export async function runHomelabCommandAction(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	command: string,
	params: { action: HomelabAction; service?: string; flags?: HomelabFlags; tail?: number },
): Promise<void> {
	if (params.action === "down") {
		const service = params.service ?? "";
		const ok = await confirmHomelabDown(ctx, service);
		if (!ok) {
			ctx.ui.notify(`Blocked: /homelab down ${service}`, "warning");
			return;
		}
	}

	ctx.ui.notify(`Running ${command}`, "info");
	const result = await executeHomelabAction(
		pi,
		ctx.cwd,
		params,
		undefined,
		(label, elapsedMs) => ctx.ui.setStatus("homelab-command", ctx.ui.theme.fg("warning", `${label}… (${Math.round(elapsedMs / 1000)}s)`)),
	);
	ctx.ui.setStatus("homelab-command", undefined);
	await appendHomelabCommandResult(pi, command, result.text, result.details);
}

export function registerHomelabCommand(pi: ExtensionAPI) {
	pi.registerEntryRenderer<HomelabCommandEntry>(HOMELAB_ENTRY_TYPE, (entry, { expanded }, theme) => {
		const data = entry.data as HomelabCommandEntry;
		let text = theme.fg("toolTitle", theme.bold(`/${data.command}`));
		text += "\n";
		const rendered = renderHomelabResult(
			{ content: [{ type: "text", text: data.text }], details: data.details },
			{ expanded, isPartial: false },
			theme,
		);
		text += rendered.render(120).join("\n");
		return new Text(text, 0, 0);
	});

	pi.registerCommand("homelab", {
		description: "Open Docker homelab dashboard or run: list/status/logs/up/restart/down",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const parts = tokenize(prefix);
			const values = parts.length <= 1
				? ["list", "status", "logs", "up", "restart", "down"]
				: listServices(resolveBaseDir(process.cwd()));
			const current = parts.at(-1) ?? "";
			const items = values.filter((value) => value.startsWith(current)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseHomelabCommand(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			if (parsed.dashboard) {
				await runHomelabDashboard(pi, ctx);
				return;
			}
			await runHomelabCommandAction(pi, ctx, `homelab ${args.trim()}`, parsed);
		},
	});
}
