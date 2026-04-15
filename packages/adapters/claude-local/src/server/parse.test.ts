import { describe, expect, it } from "vitest";
import { isClaudeSubscriptionExhausted } from "./parse.js";

describe("isClaudeSubscriptionExhausted", () => {
  it("returns false when parsed is null", () => {
    expect(isClaudeSubscriptionExhausted(null)).toBe(false);
  });

  it("returns false when is_error is false", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: false, result: "You've hit your limit" })).toBe(false);
  });

  it("returns false when is_error is true but result does not mention limit", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true, result: "Some other error" })).toBe(false);
  });

  it("returns false when is_error is true and result is empty", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true, result: "" })).toBe(false);
  });

  it("returns true when is_error: true and result contains \"You've hit your limit\"", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "You've hit your limit · resets 10pm (UTC)" }),
    ).toBe(true);
  });

  it("returns true for the alternate phrasing \"you have hit your limit\"", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "you have hit your limit on usage" }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "YOU'VE HIT YOUR LIMIT" }),
    ).toBe(true);
  });

  it("returns false when result field is missing", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true })).toBe(false);
  });
});
