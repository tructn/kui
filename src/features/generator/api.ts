// Mirrors `src-tauri/src/features/generator/commands.rs`.
import { callCommand } from "@/lib/invoke";
import { startStream } from "@/lib/stream";

import type { GeneratedRecord, GenerateProgress, GenerateRequest, GeneratorInfo, RecordTemplate } from "./types";

export const generatorApi = {
  list: () => callCommand<GeneratorInfo[]>("list_generators"),
  preview: (template: RecordTemplate, count: number) =>
    callCommand<GeneratedRecord[]>("preview_records", { template, count }),
  /** Produces records, reporting progress after each batch. Resolves with the final tally. */
  generate: (clusterId: string, request: GenerateRequest, onProgress: (p: GenerateProgress) => void) =>
    startStream<GenerateProgress, GenerateProgress>("generate_records", { clusterId, request }, onProgress),
};
