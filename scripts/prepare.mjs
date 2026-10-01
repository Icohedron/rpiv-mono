import { existsSync } from "node:fs";
import { join } from "node:path";

// Local development installs include Husky; Pi's production git installs
// omit dev dependencies and don't need hooks.
if (existsSync(join(process.cwd(), "node_modules", ".bin", "husky"))) {
	const { spawnSync } = await import("node:child_process");
	const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "husky"), { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
