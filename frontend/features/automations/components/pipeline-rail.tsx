import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { isUnlocked, STAGES, stageIssue, stageSummary, type StageId } from "../pipeline";
import type { Automation } from "../types";

interface StepRailProps {
  automation: Automation;
  active: StageId;
  onSelect: (stage: StageId) => void;
  /** Steps the user has opened. Only these get a check, so a step that is fine by default doesn't look done. */
  visited: ReadonlySet<StageId>;
  /** Show unfinished stages as errors, after a save was tried. */
  flagIssues: boolean;
}

/** The three steps of an automation, each with a line saying how it is set up. */
export function StepRail({ automation, active, onSelect, visited, flagIssues }: StepRailProps) {
  return (
    <nav aria-label="Steps">
      <ol className="flex gap-2 lg:flex-col lg:gap-0">
        {STAGES.map((stage, index) => {
          const issue = stageIssue(stage.id, automation);
          const isActive = stage.id === active;
          const locked = !isUnlocked(stage.id, automation);
          const done = issue === null && visited.has(stage.id);
          return (
            <li key={stage.id} className="relative min-w-0 flex-1 lg:flex-none">
              {index < STAGES.length - 1 && (
                <span aria-hidden className="absolute top-10 bottom-0 left-[1.4rem] hidden w-px bg-border lg:block" />
              )}
              <button
                type="button"
                disabled={locked}
                title={locked ? "Finish the step before it first" : undefined}
                aria-current={isActive ? "step" : undefined}
                onClick={() => onSelect(stage.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 lg:mb-4",
                  isActive ? "bg-muted ring-1 ring-primary/40" : "bg-transparent",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    done && "border-primary bg-primary text-primary-foreground",
                    isActive && !done && "border-primary text-primary",
                    issue !== null && flagIssues && "border-destructive text-destructive",
                    !done && !isActive && !(issue !== null && flagIssues) && "text-muted-foreground",
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{stage.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{stageSummary(stage.id, automation)}</span>
                  {issue !== null && flagIssues && <span className="mt-0.5 block text-xs text-destructive">{issue}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
