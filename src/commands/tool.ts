import { executeTool, listTools, ApiError } from "../lib/api.js";

export async function toolCommand(
  toolName: string,
  args: string[]
): Promise<void> {
  // Special case: list tools
  if (toolName === "list" || toolName === "ls") {
    const response = await listTools();
    console.log("Available tools:");
    for (const tool of response.tools) {
      console.log(`  ${tool.function.name}`);
      const desc = tool.function.description;
      console.log(`    ${desc.length > 100 ? desc.slice(0, 100) + "..." : desc}`);
    }
    return;
  }

  try {
    const result = await executeTool(toolName, args);

    if (result.error) {
      console.error(result.output);
      process.exit(1);
    }

    // Output raw — this is what Claude will parse
    process.stdout.write(result.output);
    if (!result.output.endsWith("\n")) {
      process.stdout.write("\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = error instanceof ApiError ? error.status : undefined;
    console.error(JSON.stringify({ error: message, ...(status && { status }) }));
    process.exit(1);
  }
}
