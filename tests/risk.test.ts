import { describe, it, expect } from "vitest";
import { classifyTool, describeTool } from "../src/risk.js";

describe("classifyTool", () => {
  it("auto-allows read-only tools when autoAllow is true", () => {
    expect(classifyTool("Read", true)).toBe("allow");
    expect(classifyTool("Grep", true)).toBe("allow");
    expect(classifyTool("WebFetch", true)).toBe("allow");
  });

  it("confirms read-only tools when autoAllow is false", () => {
    expect(classifyTool("Read", false)).toBe("confirm");
  });

  it("always confirms Bash and writes", () => {
    expect(classifyTool("Bash", true)).toBe("confirm");
    expect(classifyTool("Write", true)).toBe("confirm");
    expect(classifyTool("Edit", true)).toBe("confirm");
    expect(classifyTool("NotebookEdit", true)).toBe("confirm");
  });

  it("confirms unknown tools by default", () => {
    expect(classifyTool("SomeMcpTool", true)).toBe("confirm");
  });
});

describe("describeTool", () => {
  it("summarizes a Bash command", () => {
    expect(describeTool("Bash", { command: "rm foo.txt" })).toBe(
      "Bash: rm foo.txt",
    );
  });

  it("summarizes a Write with the file path", () => {
    expect(describeTool("Write", { file_path: "/tmp/x.ts" })).toBe(
      "Write: /tmp/x.ts",
    );
  });

  it("falls back to the tool name when no detail is known", () => {
    expect(describeTool("Edit", {})).toBe("Edit");
  });
});
