import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function buildAnthropicRemoteConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  if (v.model) ac.model = v.model;
  
  const env: Record<string, any> = {};
  if (v.envVars) {
     // Basic env var parsing
     for (const line of v.envVars.split('\n')) {
       const [k, ...rest] = line.split('=');
       if (k && rest.length > 0) env[k.trim()] = rest.join('=').trim();
     }
  }
  if (Object.keys(env).length > 0) ac.env = env;
  
  ac.maxTurnsPerRun = v.maxTurnsPerRun || 10;
  ac.timeoutSec = 120;
  
  return ac;
}
