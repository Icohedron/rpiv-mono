import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExtensions } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

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

	it("loads all git extensions without node_modules or upstream packages", async () => {
		const checkout = mkdtempSync(join(tmpdir(), "rpiv-git-install-"));
		try {
			for (const name of ["rpiv-config", "rpiv-ask-user-question", "rpiv-todo", "rpiv-btw"]) {
				cpSync(join(root, "packages", name), join(checkout, "packages", name), { recursive: true });
			}
			const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			const paths = manifest.pi.extensions.map((entry: string) => join(checkout, entry));
			const result = await loadExtensions(paths, checkout);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(3);
			expect(existsSync(join(checkout, "node_modules"))).toBe(false);
		} finally {
			rmSync(checkout, { recursive: true, force: true });
		}
	});

	it("does not declare upstream @juicesharp dependencies for the git extensions", () => {
		for (const name of ["rpiv-ask-user-question", "rpiv-todo", "rpiv-btw"]) {
			const manifest = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
			const dependencies = {
				...manifest.dependencies,
				...manifest.optionalDependencies,
				...manifest.peerDependencies,
			};
			expect(Object.keys(dependencies).filter((name) => name.startsWith("@juicesharp/"))).toEqual([]);
		}
	});

	it("runs prepare without creating a dependency on upstream package names", () => {
		const checkout = mkdtempSync(join(tmpdir(), "rpiv-git-prepare-"));
		try {
			const prepared = spawnSync(process.execPath, [join(root, "scripts", "prepare.mjs")], {
				cwd: checkout,
				encoding: "utf8",
			});
			expect(prepared.status, prepared.stderr).toBe(0);
			expect(existsSync(join(checkout, "node_modules"))).toBe(false);
		} finally {
			rmSync(checkout, { recursive: true, force: true });
		}
	});
});
