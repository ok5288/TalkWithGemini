import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(".github/scripts/extract-release-notes.mjs");

function extract(changelog: string, tag = "v2.7.0") {
  const directory = mkdtempSync(join(tmpdir(), "neo-chat-release-notes-"));
  try {
    const input = join(directory, "CHANGELOG.md");
    const output = join(directory, "notes.md");
    writeFileSync(input, changelog);
    const result = spawnSync(process.execPath, [script, tag, input, output], {
      encoding: "utf8",
    });
    return {
      status: result.status,
      stderr: result.stderr,
      notes: result.status === 0 ? readFileSync(output, "utf8") : undefined,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("release notes extraction", () => {
  it("extracts the current package release from the real changelog", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    const result = extract(readFileSync("CHANGELOG.md", "utf8"), `v${version}`);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.notes?.trim().length).toBeGreaterThan(0);
    expect(result.notes).not.toMatch(/^## /m);
  });

  it.each(["v2.7.0", "2.7.0", "[v2.7.0] - 2026-10-21"])(
    "extracts only the matching %s section, preserving subheadings",
    (heading) => {
      const result = extract(
        `# Changelog\n\n## Unreleased\nFuture\n\n## ${heading}\n\n### Fixed\n- Current\n\n## v2.6.0\nPrevious\n`,
      );
      expect(result.status).toBe(0);
      expect(result.notes).toBe("### Fixed\n- Current\n");
    },
  );

  it("accepts CRLF and an unprefixed tag", () => {
    expect(extract("## v2.7.0\r\n\r\n- Fixed\r\n", "2.7.0").notes).toBe(
      "- Fixed\n",
    );
  });

  it("rejects a missing release without using a prefix match", () => {
    const result = extract("## v2.7.01\n- Other release\n");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not find");
    expect(result.notes).toBeUndefined();
  });

  it("rejects an empty release", () => {
    const result = extract("## v2.7.0\n\n## v2.6.0\n- Previous\n");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is empty");
    expect(result.notes).toBeUndefined();
  });
});
