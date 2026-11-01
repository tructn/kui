import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { type PayloadView, payloadViews, renderPayload } from "../payload-view";
import type { Payload } from "../types";

const VIEW_LABELS: Record<PayloadView, string> = { json: "JSON", base64: "Base64" };

/**
 * Which view (JSON / Base64) a payload is shown in, and its text in that view.
 * The choice is kept when `payload` changes; a binary payload always shows base64.
 */
export function usePayloadView(payload: Payload | null) {
  const [view, setView] = useState<PayloadView>("json");
  const views = payload ? payloadViews(payload) : [];
  const shown = views.includes(view) ? view : "base64";
  const text = useMemo(() => (payload ? renderPayload(payload, shown) : null), [payload, shown]);
  return { views, shown, setView, text };
}

interface PayloadViewTabsProps {
  views: PayloadView[];
  value: PayloadView;
  onChange: (view: PayloadView) => void;
  /** Smaller tabs, for inside a table row. */
  compact?: boolean;
  /** Names the payload for screen readers, e.g. "Show value as". */
  label?: string;
}

/** The JSON / Base64 switch above a payload. */
export function PayloadViewTabs({ views, value, onChange, compact, label = "Show as" }: PayloadViewTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as PayloadView)}>
      <TabsList aria-label={label} className={cn(compact && "group-data-horizontal/tabs:h-6 p-0.5")}>
        {views.map((v) => (
          <TabsTrigger key={v} value={v} className={cn(compact && "px-1.5 font-sans text-xs")}>
            {VIEW_LABELS[v]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** "UTF-8" or "Binary": how the payload's bytes are encoded. */
export function encodingLabel(payload: Payload) {
  return payload.encoding === "utf8" ? "UTF-8" : "Binary";
}
