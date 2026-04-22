import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["shared/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/anterra-monorepo/**"],
		testTimeout: 10000,
	},
});
