/**
 * homelab-docker — project-local Pi extension for the Docker homelab repo.
 *
 * Registers a single `homelab` tool (list/status/logs/up/restart/down) that
 * wraps docker + ./manage-container.sh. All logic lives in ./tools.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHomelabCommand } from "./command.ts";
import { registerHomelabTool } from "./tools.ts";

export default function (pi: ExtensionAPI) {
	registerHomelabTool(pi);
	registerHomelabCommand(pi);
}
