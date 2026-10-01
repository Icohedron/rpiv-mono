import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Pi installs git sources with npm install --omit=dev. The repository's
// workspaces are opt-in so npm doesn't pull in every sibling extension, but
// ask-user-question and todo still need the checked-out shared config library.
const scopeDir = join(process.cwd(), "node_modules", "@juicesharp");
const configLink = join(scopeDir, "rpiv-config");
if (!existsSync(configLink)) {
	mkdirSync(scopeDir, { recursive: true });
	symlinkSync("../../packages/rpiv-config", configLink, "dir");
}

// A full workspace install already links rpiv-config and includes Husky.
// Production git installs omit the Husky dev dependency.
if (existsSync(join(process.cwd(), "node_modules", ".bin", "husky"))) {
	const { spawnSync } = await import("node:child_process");
	const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "husky"), { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
