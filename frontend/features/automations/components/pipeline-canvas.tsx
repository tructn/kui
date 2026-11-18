import "@xyflow/react/dist/base.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChangeset,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { CircleAlertIcon, DatabaseIcon, PlusIcon, ShuffleIcon, WebhookIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { useResolvedTheme } from "@/app/stores/theme-store";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { nodeIssue, nodeKey, nodesOf, nodeSummary, type NodeRef } from "../pipeline";
import { MAX_ROUTES, type Automation } from "../types";

const COLUMN = 300;
const ROW = 110;

type StepData = {
  ref: NodeRef;
  title: string;
  summary: string;
  /** A route's own filter, so it's clear which messages take this branch. */
  filter: string | null;
  /** Shown only after a save was tried, so a new pipeline doesn't start out red. */
  issue: string | null;
  selected: boolean;
  onSelect: (ref: NodeRef) => void;
};
type StepNode = Node<StepData, "step">;

const ICONS = { source: DatabaseIcon, transform: ShuffleIcon, webhook: WebhookIcon };
const HINTS = {
  source: "The topic, its filter and the sample message every route receives.",
  transform: "What this route sends: the whole message, or fields picked from it.",
  webhook: "Where this route sends it, and the exact request.",
};

/** A box on the canvas. It is a button, so it can be reached and opened from the keyboard. */
function StepBox({ data }: NodeProps<StepNode>) {
  const { ref, title, summary, filter, issue, selected, onSelect } = data;
  const Icon = ICONS[ref.kind];
  return (
    <>
      {ref.kind !== "source" && <Handle type="target" position={Position.Left} className="opacity-0!" isConnectable={false} />}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${title}: ${summary}${filter ? `, if ${filter}` : ""}${issue ? `. ${issue}` : ""}`}
            aria-pressed={selected}
            onClick={() => onSelect(ref)}
            className={cn(
              "flex w-56 items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors outline-none hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50",
              selected && "border-primary ring-2 ring-primary/30",
              issue && "border-destructive",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm font-medium">
                {title}
                {issue && <CircleAlertIcon aria-hidden className="size-3.5 text-destructive" />}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{summary}</span>
              {filter && (
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground" title={filter}>
                  if {filter}
                </span>
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {issue ?? HINTS[ref.kind]}
        </TooltipContent>
      </Tooltip>
      {ref.kind !== "webhook" && <Handle type="source" position={Position.Right} className="opacity-0!" isConnectable={false} />}
    </>
  );
}

const NODE_TYPES = { step: StepBox };
const FIT = { padding: 0.2, maxZoom: 1 };

// base.css paints with its own greys and #141414, and picks light or dark from `color-scheme`, which
// follows the OS rather than the theme chosen in KUI; point it at the app's tokens and theme instead.
const THEME = {
  "--xy-background-color": "transparent",
  "--xy-node-color": "var(--foreground)",
  "--xy-edge-stroke": "var(--muted-foreground)",
  "--xy-selection-background-color": "color-mix(in oklch, var(--primary) 10%, transparent)",
  "--xy-selection-border": "1px dashed var(--primary)",
} as CSSProperties;

/** Keeps every box in view as routes come and go; `fitView` alone only fits once. */
function FitOnChange({ rows }: { rows: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // After React Flow has measured the new boxes.
    const frame = requestAnimationFrame(() => void fitView({ ...FIT, duration: 200 }));
    return () => cancelAnimationFrame(frame);
  }, [rows, fitView]);
  return null;
}

function titleOf(automation: Automation, ref: NodeRef): string {
  if (ref.kind === "source") return "Topic";
  const index = automation.routes.findIndex((r) => r.id === ref.route);
  const label = ref.kind === "transform" ? "Transform" : "Webhook";
  return automation.routes.length > 1 ? `${label} ${index + 1}` : label;
}

/** Where a node starts: the topic on the left, each route as a row of transform then webhook. */
function layout(automation: Automation, ref: NodeRef): XYPosition {
  const rows = automation.routes.length;
  if (ref.kind === "source") return { x: 0, y: ((rows - 1) * ROW) / 2 };
  const row = automation.routes.findIndex((r) => r.id === ref.route);
  return { x: ref.kind === "transform" ? COLUMN : COLUMN * 2, y: row * ROW };
}

interface PipelineCanvasProps {
  automation: Automation;
  selected: NodeRef;
  onSelect: (ref: NodeRef) => void;
  flagIssues: boolean;
  onAddRoute: () => void;
}

/** The pipeline as a graph: topic → transform → webhook, one row per route. Boxes can be dragged. */
export function PipelineCanvas({ automation, selected, onSelect, flagIssues, onAddRoute }: PipelineCanvasProps) {
  const theme = useResolvedTheme();
  // Only positions the user dragged to; everything else follows the layout as routes come and go.
  const [moved, setMoved] = useState<Record<string, XYPosition>>({});

  const nodes: StepNode[] = nodesOf(automation).map((ref) => {
    const key = nodeKey(ref);
    return {
      id: key,
      type: "step",
      position: moved[key] ?? layout(automation, ref),
      data: {
        ref,
        title: titleOf(automation, ref),
        summary: nodeSummary(automation, ref),
        filter: ref.kind === "transform" ? (automation.routes.find((r) => r.id === ref.route)?.query?.trim() ?? null) || null : null,
        issue: flagIssues ? nodeIssue(automation, ref) : null,
        selected: key === nodeKey(selected),
        onSelect,
      },
    };
  });

  const edges: Edge[] = automation.routes.flatMap((route) => {
    const transform = nodeKey({ kind: "transform", route: route.id });
    const style = { stroke: "var(--muted-foreground)", strokeWidth: 1.5 };
    const markerEnd = { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)" };
    return [
      {
        id: `in:${route.id}`,
        source: "source",
        target: transform,
        style,
        markerEnd,
      },
      { id: `out:${route.id}`, source: transform, target: nodeKey({ kind: "webhook", route: route.id }), style, markerEnd },
    ];
  });

  function onNodesChange(changes: NodeChangeset<StepNode>) {
    const dragged = changes.getByType("position");
    if (dragged.length === 0) return;
    setMoved((current) => {
      const next = { ...current };
      for (const change of dragged) if (change.position) next[change.id] = change.position;
      return next;
    });
  }

  return (
    <ReactFlow<StepNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={FIT}
      minZoom={0.4}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      style={{ ...THEME, colorScheme: theme }}
      aria-label="Pipeline graph"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1.6} color="color-mix(in oklch, var(--muted-foreground) 45%, transparent)" />
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="overflow-hidden rounded-md border bg-card text-foreground shadow-sm [&>button]:size-7 [&>button]:border-b [&>button]:transition-colors [&>button:hover]:bg-accent [&>button:last-child]:border-b-0"
      />
      <FitOnChange rows={automation.routes.length} />
      <Panel position="top-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={automation.routes.length >= MAX_ROUTES}
          title="Send matching messages somewhere else too, shaped their own way"
          onClick={onAddRoute}
        >
          <PlusIcon /> Route
        </Button>
      </Panel>
    </ReactFlow>
  );
}
