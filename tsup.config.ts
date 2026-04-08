import { readFileSync } from "node:fs";
import { makeExternal } from "@repo/tsup-config";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const { external, esbuildPlugins } = makeExternal(pkg);

export default defineConfig({
	// Only build server + shared — client has React (Vite handles it)
	entry: [
		"server/index.ts",
		"shared/index.ts",
		"shared/manifest.ts",
		"shared/indexing-svm/index.ts",
		"shared/svm/program.ts",
	],
	format: ["esm"],
	target: "node20",
	platform: "node",
	sourcemap: true,
	clean: true,
	// splitting: true ensures shared code lives in one chunk
	// rather than being inlined into both server/index.js and shared/index.js.
	splitting: true,
	external,
	esbuildPlugins,
});
