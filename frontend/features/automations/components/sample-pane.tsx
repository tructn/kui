import { PanelRightCloseIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { formatSample, type SampleMessage } from "../sample-fields";

export const SAMPLE_PANE_ID = "automation-sample-pane";

interface SamplePaneProps {
  sample: SampleMessage;
  sampleBar: ReactNode;
  onClose: () => void;
}

/** The sample message every route is tried on, beside the canvas and settings. */
export function SamplePane({ sample, sampleBar, onClose }: SamplePaneProps) {
  return (
    <aside
      id={SAMPLE_PANE_ID}
      aria-label="Sample message"
      className="flex w-96 max-w-[40%] min-w-0 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-muted/10 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Sample message</h2>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Hide the sample" title="Hide the sample" onClick={onClose}>
          <PanelRightCloseIcon />
        </Button>
      </div>
      {sampleBar}
      {sample.value.trim() !== "" && (
        <pre aria-label="Sample message as read" className="overflow-auto rounded-md border bg-muted/30 p-2.5 font-mono text-xs">
          {formatSample(sample.value)}
        </pre>
      )}
    </aside>
  );
}
