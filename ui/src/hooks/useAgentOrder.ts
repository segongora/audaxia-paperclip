import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@paperclipai/shared";
import { getAgentOrderStorageKey, readAgentOrder, sortAgentsByStoredOrder } from "../lib/agent-order";

type UseAgentOrderParams = {
  agents: Agent[];
  companyId: string | null | undefined;
  userId: string | null | undefined;
};

export function useAgentOrder({ agents, companyId, userId }: UseAgentOrderParams) {
  const storageKey = useMemo(
    () => (companyId ? getAgentOrderStorageKey(companyId, userId) : null),
    [companyId, userId],
  );

  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    if (!storageKey) return agents.map((a) => a.id);
    return readAgentOrder(storageKey);
  });

  useEffect(() => {
    if (!storageKey) {
      setOrderedIds(agents.map((a) => a.id));
      return;
    }
    setOrderedIds(readAgentOrder(storageKey));
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedAgents = useMemo(
    () => sortAgentsByStoredOrder(agents, orderedIds),
    [agents, orderedIds],
  );

  return { orderedAgents, orderedIds };
}
