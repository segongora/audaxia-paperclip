type MaybeId = string | null | undefined;

export function resolveIssueGoalId(input: {
  projectId: MaybeId;
  goalId: MaybeId;
  projectGoalId?: MaybeId;
  defaultGoalId: MaybeId;
}): string | null {
  if (!input.projectId && !input.goalId) {
    return input.defaultGoalId ?? null;
  }
  return input.goalId ?? input.projectGoalId ?? null;
}

export function resolveNextIssueGoalId(input: {
  currentProjectId: MaybeId;
  currentGoalId: MaybeId;
  currentProjectGoalId?: MaybeId;
  projectId?: MaybeId;
  goalId?: MaybeId;
  projectGoalId?: MaybeId;
  defaultGoalId: MaybeId;
}): string | null {
  const projectId =
    input.projectId !== undefined ? input.projectId : input.currentProjectId;
  const goalId =
    input.goalId !== undefined ? input.goalId : input.currentGoalId;
  const effectiveProjectGoalId =
    input.projectId !== undefined ? input.projectGoalId : input.currentProjectGoalId;

  if (!projectId && !goalId) {
    return input.defaultGoalId ?? null;
  }
  return goalId ?? effectiveProjectGoalId ?? null;
}
