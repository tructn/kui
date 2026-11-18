import { CopyIcon, UploadCloudIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useClusters } from "@/features/clusters";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { defaultConnectForm, optionsOf, publishedSummary, targetOf, type ConnectForm } from "../connect-form";
import { useConnectForms } from "../connect-store";
import { useConnectPreview, usePublishConnect } from "../queries";
import type { Automation } from "../types";

interface KafkaConnectDialogProps {
  /** The automation to publish; null keeps the dialog closed. */
  automation: Automation | null;
  onClose: () => void;
}

/** Publishes a pipeline to a Kafka Connect cluster, where it keeps running without KUI. */
export function KafkaConnectDialog({ automation, onClose }: KafkaConnectDialogProps) {
  return (
    <Dialog open={automation !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Publish {automation?.name} to Kafka Connect</DialogTitle>
          <DialogDescription>
            Each route becomes a Confluent HTTP Sink connector that runs on your Connect cluster, without KUI.
          </DialogDescription>
        </DialogHeader>
        {automation && <PublishForm automation={automation} onPublished={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function PublishForm({ automation, onPublished }: { automation: Automation; onPublished: () => void }) {
  const { data: clusters = [] } = useClusters();
  const remembered = useConnectForms((s) => s.byCluster[automation.clusterId]);
  const remember = useConnectForms((s) => s.remember);
  const [form, setForm] = useState<ConnectForm>(
    () =>
      remembered ??
      defaultConnectForm(clusters.find((c) => c.id === automation.clusterId)?.bootstrapServers ?? "localhost:9092"),
  );
  const [password, setPassword] = useState("");
  const update = (patch: Partial<ConnectForm>) => setForm((f) => ({ ...f, ...patch }));

  const options = useDebouncedValue(optionsOf(form), 300);
  const preview = useConnectPreview(automation, options);
  const publish = usePublishConnect();
  const plan = preview.data;
  const blocked = !plan || plan.blockers.length > 0;

  function submit() {
    remember(automation.clusterId, form);
    publish.mutate(
      { automation, target: targetOf(form, password), options: optionsOf(form) },
      {
        onSuccess: (published) => {
          toast.success(`Published ${automation.name} to Kafka Connect`, { description: publishedSummary(published) });
          onPublished();
        },
        onError: (e) => toast.error("Could not publish", { description: e.message }),
      },
    );
  }

  const configs = plan ? JSON.stringify(plan.connectors, null, 2) : "";

  return (
    <div className="grid min-h-0 gap-6 overflow-auto md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="connect-url">Kafka Connect URL</FieldLabel>
          <Input
            id="connect-url"
            className="font-mono"
            value={form.url}
            onChange={(e) => update({ url: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="connect-user">User (optional)</FieldLabel>
            <Input id="connect-user" value={form.username} onChange={(e) => update({ username: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="connect-password">Password</FieldLabel>
            <Input
              id="connect-password"
              type="password"
              autoComplete="off"
              disabled={!form.username.trim()}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="connect-bootstrap">Bootstrap servers for Connect</FieldLabel>
          <Input
            id="connect-bootstrap"
            className="font-mono"
            value={form.bootstrapServers}
            onChange={(e) => update({ bootstrapServers: e.target.value })}
          />
          <FieldDescription>
            This Kafka cluster as the Connect workers reach it. The connector keeps its license and delivery reports
            there.
          </FieldDescription>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="connect-prefix">Name prefix</FieldLabel>
            <Input
              id="connect-prefix"
              className="font-mono"
              value={form.namePrefix}
              onChange={(e) => update({ namePrefix: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="connect-rf">Replication factor</FieldLabel>
            <Input
              id="connect-rf"
              inputMode="numeric"
              value={form.replicationFactor}
              onChange={(e) => update({ replicationFactor: e.target.value })}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="connect-properties">Extra properties (optional)</FieldLabel>
          <Textarea
            id="connect-properties"
            className="min-h-16 font-mono text-xs"
            placeholder="confluent.topic.security.protocol=SASL_SSL"
            value={form.propertiesText}
            onChange={(e) => update({ propertiesText: e.target.value })}
          />
          <FieldDescription>
            One key=value per line, added to every connector. Saved on this machine, so keep secrets out of it.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <div className="flex min-w-0 flex-col gap-3">
        {preview.error && (
          <Alert variant="destructive">
            <AlertTitle>The pipeline isn't valid</AlertTitle>
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        )}
        {plan && plan.blockers.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Change these to publish</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {plan && plan.warnings.length > 0 && (
          <Alert>
            <AlertTitle>Runs differently on Kafka Connect</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {plan && plan.connectors.length > 0 && (
          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Connector configuration</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void navigator.clipboard.writeText(configs).then(() => toast.success("Copied"))}
              >
                <CopyIcon /> Copy
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">{configs}</pre>
            <p className="text-xs text-muted-foreground">
              The webhook URL and header values are shown as &lt;hidden&gt; and sent only when you publish.
            </p>
          </div>
        )}
      </div>

      <DialogFooter className="md:col-span-2">
        <Button type="button" disabled={blocked || !form.url.trim() || publish.isPending} onClick={submit}>
          {publish.isPending ? <Spinner /> : <UploadCloudIcon />} Publish
        </Button>
      </DialogFooter>
    </div>
  );
}
