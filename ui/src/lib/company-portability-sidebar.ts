import type { Agent, CompanyPortabilitySidebarOrder, Project } from "@paperclipai/shared";
import { normalizeAgentUrlKey } from "@paperclipai/shared";

function deriveSlug(name: string): string {
  return normalizeAgentUrlKey(name) ?? "item";
}

/**
 * Build a map from agent id -> portable slug (matching the slug allocation
 * used by the server-side export). Duplicate names get a numeric suffix
 * (-2, -3, …) assigned in the order the agents appear in the input array.
 */
export function buildPortableAgentSlugMap(agents: Agent[]): Map<string, string> {
  const slugCounts = new Map<string, number>();
  const result = new Map<string, string>();

  for (const agent of agents) {
    const base = deriveSlug(agent.name);
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    result.set(agent.id, slug);
  }

  return result;
}

/**
 * Build a map from project id -> portable slug.
 */
export function buildPortableProjectSlugMap(projects: Project[]): Map<string, string> {
  const slugCounts = new Map<string, number>();
  const result = new Map<string, string>();

  for (const project of projects) {
    const base = deriveSlug(project.name);
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    result.set(project.id, slug);
  }

  return result;
}

interface BuildPortableSidebarOrderOptions {
  agents: Agent[];
  orderedAgents: Agent[];
  projects: Project[];
  orderedProjects: Project[];
}

/**
 * Produce the portable sidebar order object that can be embedded in a
 * portability export. Slugs are derived using the same allocation logic as
 * the server-side export so that the ordering round-trips correctly on import.
 */
export function buildPortableSidebarOrder(
  options: BuildPortableSidebarOrderOptions,
): CompanyPortabilitySidebarOrder {
  const agentSlugMap = buildPortableAgentSlugMap(options.agents);
  const projectSlugMap = buildPortableProjectSlugMap(options.projects);

  const agents: string[] = [];
  for (const agent of options.orderedAgents) {
    const slug = agentSlugMap.get(agent.id);
    if (slug) agents.push(slug);
  }

  const projects: string[] = [];
  for (const project of options.orderedProjects) {
    const slug = projectSlugMap.get(project.id);
    if (slug) projects.push(slug);
  }

  return { agents, projects };
}
