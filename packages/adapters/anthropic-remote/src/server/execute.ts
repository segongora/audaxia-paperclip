import fs from "node:fs/promises";
import path from "node:path";
import { 
  AdapterExecutionContext, 
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  parseObject,
  buildPaperclipEnv,
} from "@paperclipai/adapter-utils/server-utils";
import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import Anthropic from "@anthropic-ai/sdk";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, authToken } = ctx;

  const model = asString(config.model, "claude-3-7-sonnet-20250219");
  const maxTurns = asNumber(config.maxTurnsPerRun, 10);
  const apiKey = asString(config.apiKey, "") || (ctx.config.env as any)?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "ANTHROPIC_API_KEY is missing. Please configure it in agent env or instance settings.",
      errorCode: "claude_auth_required"
    };
  }

  const anthropic = new Anthropic({ apiKey });

  // Workspace context
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const cwd = asString(workspaceContext.cwd, process.cwd());

  const env = { 
    ...buildPaperclipEnv(agent),
    PAPERCLIP_RUN_ID: runId,
    PAPERCLIP_WORKSPACE_CWD: cwd,
  };

  await onLog("stdout", `[paperclip] Starting remote Claude session (model: ${model})\n`);

  const tools: Anthropic.Tool[] = [
    {
      name: "bash",
      description: "Execute a bash command in the workspace.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run." }
        },
        required: ["command"]
      }
    },
    {
      name: "read_file",
      description: "Read the contents of a file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file." }
        },
        required: ["path"]
      }
    },
    {
      name: "write_to_file",
      description: "Write content to a file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file." },
          content: { type: "string", description: "The content to write." }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "ls",
      description: "List files in a directory.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the directory." }
        },
        required: ["path"]
      }
    }
  ];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Continue your Paperclip work." }
  ];

  let cumulativeUsage = { inputTokens: 0, outputTokens: 0 };
  let turn = 0;

  try {
    while (turn < maxTurns) {
      turn++;
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        messages,
        tools,
      });

      cumulativeUsage.inputTokens += response.usage.input_tokens;
      cumulativeUsage.outputTokens += response.usage.output_tokens;

      const textContent = response.content.find(c => c.type === "text")?.text || "";
      if (textContent) {
        await onLog("stdout", textContent + "\n");
      }

      const toolCalls = response.content.filter(c => c.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (toolCalls.length === 0) {
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          provider: "anthropic",
          model,
          billingType: "api",
          usage: cumulativeUsage,
          summary: textContent || "Task completed."
        };
      }

      // Add assistant's message with tool calls to history
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of toolCalls) {
        await onLog("stdout", `[paperclip] Tool Call: ${toolCall.name}(${JSON.stringify(toolCall.input)})\n`);
        let result = "";
        try {
          if (toolCall.name === "bash") {
             const command = (toolCall.input as any).command;
             const proc = await runChildProcess(runId, "bash", ["-c", command], {
                cwd,
                env,
                timeoutSec: 60,
                graceSec: 10,
                onLog: async (stream, chunk) => {
                   await onLog(stream, chunk);
                }
             });
             result = `[exit code ${proc.exitCode ?? -1}]\nSTDOUT:\n${proc.stdout}\nSTDERR:\n${proc.stderr}`;
          } else if (toolCall.name === "read_file") {
             const filePath = path.resolve(cwd, (toolCall.input as any).path);
             result = await fs.readFile(filePath, "utf-8");
          } else if (toolCall.name === "write_to_file") {
             const filePath = path.resolve(cwd, (toolCall.input as any).path);
             const content = (toolCall.input as any).content;
             await fs.mkdir(path.dirname(filePath), { recursive: true });
             await fs.writeFile(filePath, content, "utf-8");
             result = "File written successfully.";
          } else if (toolCall.name === "ls") {
             const dirPath = path.resolve(cwd, (toolCall.input as any).path);
             const entries = await fs.readdir(dirPath);
             result = entries.join("\n");
          }
        } catch (err: any) {
          result = `Error: ${err.message}`;
        }
        
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: result
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: "Max turns reached.",
      usage: cumulativeUsage,
    };
  } catch (err: any) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: err.message,
      errorCode: "api_error"
    };
  }
}
