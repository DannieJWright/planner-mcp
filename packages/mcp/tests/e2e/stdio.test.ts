import { describe, expect, it } from "vitest";

describe("MCP distribution", () => {
  it("declares the stdio executable", async () => {
    const packageJson = await import("../../package.json", { with: { type: "json" } });
    expect(packageJson.default.bin).toEqual({ "planner-mcp": "dist/main.js" });
  });
});
