import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["shared/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/tex-turborepo-fix-pre-reset/**"],
		testTimeout: 10000,
	},
});
