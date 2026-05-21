import { describe, expect, test } from "bun:test";

describe("synthetic CLI", () => {
  test("prints rectangle scenario metrics as JSON", async () => {
    const proc = Bun.spawn(["bun", "./src/server/synthetic-cli.ts", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { wallCount: number; wallBlindspotCount: number; groundBlindspotCount: number };
    expect(result.wallCount).toBe(4);
    expect(result.wallBlindspotCount).toBe(3);
    expect(result.groundBlindspotCount).toBeGreaterThan(0);
  });
});
