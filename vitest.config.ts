import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".open-next/**", ".wrangler/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/lib/ingest/**/*.ts",
        "src/lib/ai/**/*.ts",
        "src/lib/analyses/**/*.ts",
        "src/lib/observability/**/*.ts",
        "src/lib/rate-limit/**/*.ts",
        "src/lib/api/**/*.ts",
        "src/lib/rag/**/*.ts",
        "src/lib/evals/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts", "src/lib/supabase/**"],
    },
  },
});
