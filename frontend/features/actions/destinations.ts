// The places an Action can send messages. Planned entries render as "soon" so the roadmap is visible; when one
// ships, it gains an `Executor` variant and becomes `available`.
import type { Executor } from "./types";

export type ExecutorKind = Executor["kind"];

export type DestinationId = "localLambda" | "localAzureFunction" | "http";

interface DestinationBase {
  id: DestinationId;
  title: string;
  /** The local tool that hosts the target. */
  runtime: string;
}

export type AvailableDestination = DestinationBase & { status: "available"; kind: ExecutorKind };
export type Destination = AvailableDestination | (DestinationBase & { status: "planned" });

const LOCAL_LAMBDA: AvailableDestination = {
  id: "localLambda",
  status: "available",
  kind: "localLambda",
  title: "AWS Lambda",
  runtime: "Lambda Test Tool · SAM CLI",
};

/** A `Record` so adding an `Executor` variant fails to compile until it has a catalog entry. */
const BY_KIND: Record<ExecutorKind, AvailableDestination> = { localLambda: LOCAL_LAMBDA };

export const DESTINATIONS: readonly Destination[] = [
  LOCAL_LAMBDA,
  { id: "localAzureFunction", status: "planned", title: "Azure Functions", runtime: "Functions Core Tools" },
  { id: "http", status: "planned", title: "HTTP request", runtime: "Any local service" },
];

export function destinationForKind(kind: ExecutorKind): AvailableDestination {
  return BY_KIND[kind];
}

export function destinationOf(executor: Executor): AvailableDestination {
  return destinationForKind(executor.kind);
}
