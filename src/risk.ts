// src/risk.ts
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
]);

// Returns "allow" if the tool may run without asking, "confirm" if it needs
// an SMS YES. Read-only tools are allowed only when autoAllow is enabled;
// everything else (Bash, writes, unknown tools) always confirms.
export function classifyTool(
  toolName: string,
  autoAllow: boolean,
): "allow" | "confirm" {
  if (autoAllow && READ_ONLY_TOOLS.has(toolName)) return "allow";
  return "confirm";
}

// Short human-readable summary of a tool call for the confirmation SMS.
export function describeTool(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    return `Bash: ${input.command}`;
  }
  if (typeof input.file_path === "string") {
    return `${toolName}: ${input.file_path}`;
  }
  return toolName;
}
