import { CheckCircle2Icon, PlugZapIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatKeyValueLines, parseKeyValueLines } from "@/lib/key-value";

import { useSaveCluster, useTestConnection } from "../queries";
import {
  emptyCluster,
  SASL_MECHANISMS,
  SECURITY_PROTOCOLS,
  usesSasl,
  usesTls,
  withoutUnusedSecurity,
  type ClusterConfig,
  type SaslMechanism,
  type SecurityProtocol,
} from "../types";

const PROTOCOL_HINTS: Record<SecurityProtocol, string> = {
  PLAINTEXT: "No encryption and no sign-in. For local and test clusters.",
  SSL: "Encrypted with TLS. If the cluster requires it, sign in with a client certificate.",
  SASL_PLAINTEXT: "Sign in with SASL over an unencrypted connection.",
  SASL_SSL: "Encrypted with TLS and sign in with SASL. Most managed clusters use this.",
};

const MECHANISM_HINTS: Record<SaslMechanism, string> = {
  PLAIN: "Username and password, sent as they are. Only safe over SASL_SSL.",
  "SCRAM-SHA-256": "Username and password. The password itself is never sent.",
  "SCRAM-SHA-512": "Username and password. The password itself is never sent.",
  OAUTHBEARER: "OAuth 2.0 client credentials. KUI gets a token from your identity provider and renews it.",
};

// The Windows build has no libcurl, which librdkafka needs to fetch OAuth tokens.
const OAUTH_SUPPORTED = !navigator.userAgent.includes("Windows");

interface ClusterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cluster to edit; omit to create a new one. */
  cluster?: ClusterConfig;
  onSaved?: (cluster: ClusterConfig) => void;
}

export function ClusterFormDialog({ open, onOpenChange, cluster, onSaved }: ClusterFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{cluster ? "Edit cluster" : "Add cluster"}</DialogTitle>
          <DialogDescription>Connection settings are stored locally on this machine.</DialogDescription>
        </DialogHeader>
        {/* Mounting the form only while open resets its state each time. */}
        {open && (
          <ClusterForm
            initial={cluster ?? emptyCluster()}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClusterForm({ initial, onSaved }: { initial: ClusterConfig; onSaved: (c: ClusterConfig) => void }) {
  const [form, setForm] = useState(initial);
  const [propertiesText, setPropertiesText] = useState(() => formatKeyValueLines(initial.properties));
  const save = useSaveCluster();
  const test = useTestConnection();

  const sasl = usesSasl(form.securityProtocol);
  const tls = usesTls(form.securityProtocol);
  const mechanism = form.saslMechanism ?? "PLAIN";
  const update = (patch: Partial<ClusterConfig>) => {
    setForm((f) => ({ ...f, ...patch }));
    test.reset();
  };
  const toConfig = (): ClusterConfig =>
    withoutUnusedSecurity({ ...form, properties: Object.fromEntries(parseKeyValueLines(propertiesText)) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate(toConfig(), {
      onSuccess: (saved) => {
        toast.success(`Saved ${saved.name}`);
        onSaved(saved);
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="cluster-name">Name</FieldLabel>
          <Input
            id="cluster-name"
            required
            autoFocus
            placeholder="Local"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="cluster-bootstrap">Bootstrap servers</FieldLabel>
          <Input
            id="cluster-bootstrap"
            required
            className="font-mono"
            placeholder="broker1:9092,broker2:9092"
            value={form.bootstrapServers}
            onChange={(e) => update({ bootstrapServers: e.target.value })}
          />
        </Field>

        <Field>
          <FieldLabel>Security protocol</FieldLabel>
          <Select
            value={form.securityProtocol}
            onValueChange={(v) => update({ securityProtocol: v as SecurityProtocol })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECURITY_PROTOCOLS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{PROTOCOL_HINTS[form.securityProtocol]}</FieldDescription>
        </Field>

        {sasl && (
          <FieldSet>
            <FieldLegend variant="label">Sign-in (SASL)</FieldLegend>
            <Field>
              <FieldLabel>Mechanism</FieldLabel>
              <Select value={mechanism} onValueChange={(v) => update({ saslMechanism: v as SaslMechanism })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SASL_MECHANISMS.map((m) => (
                    <SelectItem key={m} value={m} disabled={m === "OAUTHBEARER" && !OAUTH_SUPPORTED}>
                      {m}
                      {m === "OAUTHBEARER" && !OAUTH_SUPPORTED && " (not available on Windows yet)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{MECHANISM_HINTS[mechanism]}</FieldDescription>
            </Field>

            {mechanism === "OAUTHBEARER" ? (
              <>
                <TextField
                  id="cluster-oauth-endpoint"
                  label="Token endpoint URL"
                  required
                  placeholder="https://login.example.com/oauth2/token"
                  value={form.oauthTokenEndpoint}
                  onChange={(oauthTokenEndpoint) => update({ oauthTokenEndpoint })}
                />
                <div className="grid grid-cols-2 gap-4">
                  <TextField
                    id="cluster-oauth-client-id"
                    label="Client ID"
                    required
                    value={form.oauthClientId}
                    onChange={(oauthClientId) => update({ oauthClientId })}
                  />
                  <TextField
                    id="cluster-oauth-client-secret"
                    label="Client secret"
                    type="password"
                    required
                    value={form.oauthClientSecret}
                    onChange={(oauthClientSecret) => update({ oauthClientSecret })}
                  />
                </div>
                <TextField
                  id="cluster-oauth-scope"
                  label="Scope"
                  placeholder="Optional"
                  value={form.oauthScope}
                  onChange={(oauthScope) => update({ oauthScope })}
                />
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <TextField
                  id="cluster-username"
                  label="Username"
                  value={form.saslUsername}
                  onChange={(saslUsername) => update({ saslUsername })}
                />
                <TextField
                  id="cluster-password"
                  label="Password"
                  type="password"
                  value={form.saslPassword}
                  onChange={(saslPassword) => update({ saslPassword })}
                />
              </div>
            )}
          </FieldSet>
        )}

        {tls && (
          <FieldSet>
            <FieldLegend variant="label">Encryption (TLS)</FieldLegend>
            <TextField
              id="cluster-ssl-ca"
              label="CA certificate"
              mono
              placeholder="/path/to/ca.pem"
              description="PEM file. Leave empty to trust the same certificate authorities as your system."
              value={form.sslCaLocation}
              onChange={(sslCaLocation) => update({ sslCaLocation })}
            />
            <div className="grid grid-cols-2 gap-4">
              <TextField
                id="cluster-ssl-cert"
                label="Client certificate"
                mono
                placeholder="/path/to/client.pem"
                value={form.sslCertificateLocation}
                onChange={(sslCertificateLocation) => update({ sslCertificateLocation })}
              />
              <TextField
                id="cluster-ssl-key"
                label="Client key"
                mono
                placeholder="/path/to/client.key"
                value={form.sslKeyLocation}
                onChange={(sslKeyLocation) => update({ sslKeyLocation })}
              />
            </div>
            <TextField
              id="cluster-ssl-key-password"
              label="Key password"
              type="password"
              placeholder="Only if the key is encrypted"
              description="Client certificate and key are for clusters that require mutual TLS. Leave them empty otherwise."
              value={form.sslKeyPassword}
              onChange={(sslKeyPassword) => update({ sslKeyPassword })}
            />
            <Field orientation="horizontal">
              <Switch
                id="cluster-ssl-verify-hostname"
                checked={form.sslVerifyHostname}
                onCheckedChange={(sslVerifyHostname) => update({ sslVerifyHostname })}
              />
              <FieldLabel htmlFor="cluster-ssl-verify-hostname" className="font-normal">
                Verify broker hostname
              </FieldLabel>
            </Field>
          </FieldSet>
        )}

        <Field>
          <FieldLabel htmlFor="cluster-properties">Advanced properties</FieldLabel>
          <Textarea
            id="cluster-properties"
            className="min-h-20 font-mono text-xs"
            placeholder={"ssl.ca.location=/path/to/ca.pem\nssl.endpoint.identification.algorithm=none"}
            value={propertiesText}
            onChange={(e) => {
              setPropertiesText(e.target.value);
              test.reset();
            }}
          />
          <FieldDescription>librdkafka settings, one key=value per line.</FieldDescription>
        </Field>

        {save.error && <FieldError>{save.error.message}</FieldError>}
        {test.error && <FieldError>{test.error.message}</FieldError>}
      </FieldGroup>

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate(toConfig())}>
          {test.isPending ? <Spinner /> : test.isSuccess ? <CheckCircle2Icon className="text-emerald-500" /> : <PlugZapIcon />}
          {test.isSuccess ? `Connected · ${test.data} broker${test.data === 1 ? "" : "s"}` : "Test connection"}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  type?: "text" | "password";
  placeholder?: string;
  description?: string;
  required?: boolean;
  mono?: boolean;
}

function TextField({ id, label, value, onChange, type = "text", placeholder, description, required, mono }: TextFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        required={required}
        autoComplete="off"
        spellCheck={false}
        className={mono ? "font-mono" : undefined}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}
