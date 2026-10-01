import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Pi reads the root manifest for git:github.com/juicesharp/rpiv-mono.
describe("git package", () => {
	it("exposes exactly the three standalone extensions", () => {
		const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		expect(manifest.pi).toEqual({
			extensions: [
				"./packages/rpiv-ask-user-question/index.ts",
				"./packages/rpiv-todo/index.ts",
				"./packages/rpiv-btw/index.ts",
			],
		});
		for (const entry of manifest.pi.extensions) expect(existsSync(join(root, entry))).toBe(true);
		expect(readFileSync(join(root, ".npmrc"), "utf8")).toMatch(/^workspaces=false$/m);
	});

	it("links the local config library when npm skips workspaces", () => {
		const checkout = mkdtempSync(join(tmpdir(), "rpiv-git-install-"));
		try {
			mkdirSync(join(checkout, "packages", "rpiv-config"), { recursive: true });
			const prepared = spawnSync(process.execPath, [join(root, "scripts", "prepare.mjs")], {
				cwd: checkout,
				encoding: "utf8",
			});
			expect(prepared.status, prepared.stderr).toBe(0);
			const link = join(checkout, "node_modules", "@juicesharp", "rpiv-config");
			expect(readlinkSync(link)).toBe("../../packages/rpiv-config");
			// npm may re-run prepare on updates; do not replace an existing link.
			expect(spawnSync(process.execPath, [join(root, "scripts", "prepare.mjs")], { cwd: checkout }).status).toBe(0);
		} finally {
			rmSync(checkout, { recursive: true, force: true });
		}
	});
});
