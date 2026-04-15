import { useState } from "react";
import type { Agent } from "@paperclipai/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown, X } from "lucide-react";
import { AgentIcon } from "./AgentIconPicker";
import { cn } from "../lib/utils";

interface ReportsToPickerProps {
  agents: Agent[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  excludeAgentIds?: string[];
  chooseLabel?: string;
  disabled?: boolean;
}

export function ReportsToPicker({
  agents,
  value,
  onChange,
  excludeAgentIds,
  chooseLabel = "Choose manager…",
  disabled = false,
}: ReportsToPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const excludeSet = new Set(excludeAgentIds ?? []);
  const eligible = agents.filter(
    (a) => a.status !== "terminated" && !excludeSet.has(a.id),
  );
  const filtered = search
    ? eligible.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : eligible;

  const selected = value ? agents.find((a) => a.id === value) : null;

  function handleSelect(agentId: string | null) {
    onChange(agentId);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-1.5 truncate">
              <AgentIcon icon={selected.icon} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{chooseLabel}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="p-0 w-64" align="start">
        <div className="p-2 border-b border-border">
          <input
            autoFocus
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-56 overflow-y-auto py-1">
          {selected && (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              onClick={() => handleSelect(null)}
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              Remove
            </button>
          )}

          {filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No agents found</p>
          )}

          {filtered.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-accent",
                agent.id === value && "bg-accent",
              )}
              onClick={() => handleSelect(agent.id)}
            >
              <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{agent.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
