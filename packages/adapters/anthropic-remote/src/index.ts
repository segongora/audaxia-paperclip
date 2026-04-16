export const type = "anthropic_remote";
export const label = "Claude (Anthropic API)";

export const models = [
  { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
];

export const agentConfigurationDoc = `# anthropic_remote agent configuration

Adapter: anthropic_remote

Use when:
- You want Paperclip to invoke Anthropic API directly using an API key.
- You don't have the Claude CLI installed or want to bypass it.

Core fields:
- model (string, required): Anthropic model ID (e.g., claude-3-7-sonnet-20250219).
- promptTemplate (string, optional): run prompt template.
- env (object, optional): KEY=VALUE environment variables (must include ANTHROPIC_API_KEY if not in instance settings).
- cwd (string, optional): working directory for tool execution.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds.
- maxTurnsPerRun (number, optional): max turns for one run.
`;
