/**
 * Test a Claude credential (subscription OAuth token or API key) by making
 * a minimal real API call to Anthropic. Times out after 10 seconds.
 */

const TEST_TIMEOUT_MS = 10_000;
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

interface TestResult {
  success: boolean;
  error: string | null;
}

export async function testClaudeCredential(input: {
  type: "subscription" | "api_key";
  token: string;
}): Promise<TestResult> {
  const { type, token } = input;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (type === "api_key") {
    headers["x-api-key"] = token;
  } else {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1,
    messages: [{ role: "user", content: "hi" }],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (response.ok || response.status === 529) {
      // 529 = overloaded, but auth succeeded
      return { success: true, error: null };
    }

    let errorMessage = `HTTP ${response.status}`;
    try {
      const json = await response.json() as Record<string, unknown>;
      const msg = (json.error as Record<string, unknown>)?.message;
      if (typeof msg === "string" && msg.length > 0) {
        errorMessage = msg;
      }
    } catch {
      // ignore parse error
    }

    if (response.status === 401) {
      return { success: false, error: `Invalid ${type === "api_key" ? "API key" : "OAuth token"} — authentication rejected by Anthropic` };
    }

    return { success: false, error: errorMessage };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Test timed out after 10 seconds" };
    }
    return { success: false, error: err instanceof Error ? err.message : "Connection failed" };
  } finally {
    clearTimeout(timer);
  }
}
