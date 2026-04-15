import type { Goal } from "@paperclipai/shared";

interface OnboardingIssuePayloadOptions {
  title: string;
  description: string | null | undefined;
  assigneeAgentId: string | null | undefined;
  projectId: string | null | undefined;
  goalId: string | null | undefined;
}

export function buildOnboardingIssuePayload(options: OnboardingIssuePayloadOptions) {
  return {
    title: options.title,
    description: options.description ?? null,
    assigneeAgentId: options.assigneeAgentId ?? null,
    projectId: options.projectId ?? null,
    goalId: options.goalId ?? null,
    status: "open" as const,
    priority: "medium" as const,
    recurring: false,
  };
}

export function buildOnboardingProjectPayload(goalId: string | null | undefined) {
  return {
    name: "Getting Started",
    description: null,
    goalId: goalId ?? null,
    status: "active" as const,
  };
}

export function selectDefaultCompanyGoalId(goals: Goal[]): string | null {
  if (goals.length === 0) return null;
  // Prefer active goals at the company or team level; fall back to first goal
  const active = goals.find((g) => g.status === "active");
  return (active ?? goals[0]).id;
}
