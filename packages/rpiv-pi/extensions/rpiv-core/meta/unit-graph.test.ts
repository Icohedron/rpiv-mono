import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Output, type RunView, validateWorkflow } from "@juicesharp/rpiv-workflow";
import type { EdgeFn, ProducesScriptFn } from "@juicesharp/rpiv-workflow/registration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lessonsBlock, recordLessons } from "./lessons.js";
import { metaWorkflow } from "./presets.js";
import { type Check, defineUnitGraph } from "./unit-graph.js";

const out = (data: unknown, artifacts: Output["artifacts"] = []): Output =>
	({ kind: "json", data, artifacts, meta: { stage: "x", stageNumber: 1, ts: "t", runId: "r" } }) as Output;

const view = (named: Record<string, Output[]>, originalInput = "brief"): RunView => ({
	originalInput,
	output: undefined,
	named,
});

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "meta-graph-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const failing = (reason: string): Check => ({ name: "c", run: () => [{ source: "c", reason }] });

/** Minimal graph: research (a prompt unit with one deterministic check) then commit off. */
const tiny = (check: Check, opts: Parameters<typeof defineUnitGraph>[0]["units"][0][1] = { prompt: "go" }) =>
	defineUnitGraph({
		name: "t",
		units: [["research", { output: "research", checks: [check], ...opts }]],
		commit: false,
	});

const runCheck = async (wf: ReturnType<typeof tiny>, stage: string, named: Record<string, Output[]>) =>
	(await (wf.stages[stage] as { run: ProducesScriptFn }).run({ cwd, input: undefined, state: view(named) })).data as {
		round: number;
		decision: string;
		note?: string;
	};

const route = (wf: ReturnType<typeof tiny>, from: string, named: Record<string, Output[]>) =>
	(wf.edges[from] as EdgeFn)({ output: undefined, state: view(named) } as never);

describe("defineUnitGraph — shape", () => {
	it("the built-in meta graph passes the engine's load-time validation with no errors", () => {
		expect(validateWorkflow(metaWorkflow).filter((i) => i.severity === "error")).toEqual([]);
	});

	it("research is mandatory and must come first", () => {
		expect(() => defineUnitGraph({ name: "x", units: [["plan", { prompt: "p" }]] })).toThrow(
			/first unit must be "research"/,
		);
		expect(() => defineUnitGraph({ name: "x", units: [] })).toThrow(/research/);
	});

	it("escalation may only point upstream", () => {
		expect(() =>
			defineUnitGraph({
				name: "x",
				units: [
					["research", { prompt: "r", output: "research", onExhausted: { escalateTo: "plan" } }],
					["plan", { prompt: "p", output: "plans" }],
				],
			}),
		).toThrow(/EARLIER unit/);
	});

	it("expands each unit into producer → check → grade → gate, fix only when needed", () => {
		const s = Object.keys(metaWorkflow.stages);
		for (const k of [
			"research",
			"research-check",
			"research-grade",
			"research-gate",
			"acceptance-check",
			"plan-fix",
			"implement-fix",
			"commit",
			"learn",
		]) {
			expect(s).toContain(k);
		}
		expect(s).not.toContain("acceptance-grade"); // no graders ⇒ no panel
		expect(s).not.toContain("research-fix"); // no fix ⇒ corrections re-run the producer
	});
});

describe("the unit loop", () => {
	it("green check advances; red check corrects while rounds remain", async () => {
		const green = tiny({ name: "ok", run: () => [] });
		const g = await runCheck(green, "research-check", {});
		expect(g.decision).toBe("pass");
		expect(route(green, "research-check", { "research-check": [out(g)] })).toBe("learn");

		const red = tiny(failing("thin"));
		const r = await runCheck(red, "research-check", {});
		expect(r).toMatchObject({ round: 1, decision: "correct" });
		expect(route(red, "research-check", { "research-check": [out(r)] })).toBe("research");
	});

	it("the same failure surviving a correction stops early (before maxRounds)", async () => {
		const wf = tiny(failing("same"), { prompt: "go", maxRounds: 4 });
		const r1 = await runCheck(wf, "research-check", {});
		const r2 = await runCheck(wf, "research-check", { "research-check": [out(r1)] });
		expect(r2.round).toBe(2);
		expect(r2.decision).toBe("stop");
		expect(r2.note).toMatch(/same failures survived/);
	});

	it("changing failures keep looping until maxRounds, then the policy applies", async () => {
		let n = 0;
		const wf = tiny(
			{ name: "c", run: () => [{ source: "c", reason: `r${n++}` }] },
			{ prompt: "go", maxRounds: 2, onExhausted: "advance" },
		);
		const r1 = await runCheck(wf, "research-check", {});
		expect(r1.decision).toBe("correct");
		const r2 = await runCheck(wf, "research-check", { "research-check": [out(r1)] });
		expect(r2.decision).toBe("advance");
		expect(route(wf, "research-check", { "research-check": [out(r1), out(r2)] })).toBe("learn");
	});

	it("the correction prompt carries a scoped return record", async () => {
		const wf = tiny(failing("missing citation for Foo"));
		const r1 = await runCheck(wf, "research-check", {});
		const prompt = await (wf.stages.research as { prompt: (c: unknown) => Promise<string> | string }).prompt({
			cwd,
			input: undefined,
			state: view({ "research-check": [out(r1)] }),
		});
		expect(prompt).toMatch(/return record/);
		expect(prompt).toMatch(/UNIT {6}research \(round 1 was red; this is round 2\)/);
		expect(prompt).toMatch(/missing citation for Foo/);
		expect(prompt).toMatch(/SCOPE/);
	});

	it("an exhausted downstream unit escalates upstream and both open a new generation", async () => {
		const wf = defineUnitGraph({
			name: "e",
			commit: false,
			units: [
				["research", { prompt: "r", output: "research" }],
				["plan", { prompt: "p", output: "plans" }],
				[
					"implement",
					{ prompt: "i", checks: [failing("a1 fails")], maxRounds: 1, onExhausted: { escalateTo: "plan" } },
				],
			],
		});
		const r1 = await runCheck(wf, "implement-check", {});
		expect(r1).toMatchObject({ decision: "escalate" });
		const named = { "implement-check": [out(r1)] };
		expect(route(wf, "implement-check", named)).toBe("plan");
		const planPrompt = await (wf.stages.plan as { prompt: (c: unknown) => Promise<string> | string }).prompt({
			cwd,
			input: undefined,
			state: view(named),
		});
		expect(planPrompt).toMatch(/Escalation from downstream unit `implement`/);
		// implement re-enters in generation 1 at round 1, not at an exhausted round 2
		const again = await runCheck(wf, "implement-check", named);
		expect(again.round).toBe(1);
	});
});

describe("the learning edge", () => {
	it("corrected failures persist and surface in the next run's brief for that unit", () => {
		const red = {
			unit: "plan",
			pass: false,
			failures: [{ source: "correctness", reason: "API drift: save(_:) vs save(item:)" }],
		};
		recordLessons({ cwd, input: undefined, state: view({ "plan-gate": [out(red)] }) }, ["plan"]);
		recordLessons({ cwd, input: undefined, state: view({ "plan-gate": [out(red)] }) }, ["plan"]);
		const block = lessonsBlock(cwd, "plan");
		expect(block).toMatch(/Standing constraints/);
		expect(block).toMatch(/seen 2×\] API drift/);
		expect(lessonsBlock(cwd, "research")).toBe("");
	});
});
