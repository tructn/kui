import { Channel } from "@tauri-apps/api/core";
import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { callCommand } from "@/lib/invoke";
import { formatBytes } from "@/lib/format";

import { useUpdates } from "./stores/update-store";

/** How often a running app looks for a new version, when automatic checks are on. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Mirrors `DownloadEvent` in `src-tauri/src/updates.rs`. */
type DownloadEvent = { event: "progress"; downloaded: number; total: number | null } | { event: "installing" };

type InstallState =
  | { step: "idle" }
  | { step: "downloading"; downloaded: number; total: number | null }
  | { step: "installing" }
  | { step: "failed"; message: string };

/** Shows the update found by the last check, and installs it. Mounted once in the app shell. */
export function UpdateDialog() {
  const { available, dialogOpen, setDialogOpen } = useUpdates();
  const [install, setInstall] = useState<InstallState>({ step: "idle" });
  const busy = install.step === "downloading" || install.step === "installing";

  async function start() {
    setInstall({ step: "downloading", downloaded: 0, total: null });
    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (e) =>
      setInstall(e.event === "installing" ? { step: "installing" } : { step: "downloading", ...e });
    try {
      // Restarts the app on success, so it only returns on failure.
      await callCommand("install_update", { onEvent });
    } catch (error) {
      setInstall({ step: "failed", message: (error as Error).message });
    }
  }

  if (!available) return null;
  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            KUI {available.version} is available
            {available.prerelease && <Badge variant="outline">Release candidate</Badge>}
          </DialogTitle>
          <DialogDescription>
            You have {available.currentVersion}. KUI restarts to finish updating.
          </DialogDescription>
        </DialogHeader>

        {available.notes && (
          <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {available.notes}
          </div>
        )}

        {install.step === "downloading" && <DownloadProgress {...install} />}
        {install.step === "installing" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Installing…
          </p>
        )}
        {install.step === "failed" && <p className="text-sm text-destructive">Update failed: {install.message}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setDialogOpen(false)}>
            Later
          </Button>
          <Button disabled={busy} onClick={start}>
            {busy ? <Spinner /> : <DownloadIcon />}
            {install.step === "failed" ? "Try again" : "Install and restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DownloadProgress({ downloaded, total }: { downloaded: number; total: number | null }) {
  const percent = total ? Math.min(100, (downloaded / total) * 100) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={percent == null ? "h-full w-1/3 animate-pulse bg-primary" : "h-full bg-primary transition-[width]"}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Downloading {formatBytes(downloaded)}
        {total ? ` of ${formatBytes(total)}` : ""}
      </p>
    </div>
  );
}

/**
 * Checks for a new version at startup and every few hours, when the user
 * hasn't turned that off, and offers it in a toast. Failures (offline,
 * GitHub rate limits) are only logged: the user didn't ask for this check.
 */
export function useAutomaticUpdateCheck() {
  const checkAutomatically = useUpdates((s) => s.checkAutomatically);
  const includeReleaseCandidates = useUpdates((s) => s.includeReleaseCandidates);

  useEffect(() => {
    if (!checkAutomatically) return;
    let offered: string | null = null;
    const run = () =>
      useUpdates
        .getState()
        .check()
        .then((available) => {
          // Offer each version once per session, not on every periodic check.
          if (!available || available.version === offered) return;
          offered = available.version;
          toast.info(`KUI ${available.version} is available`, {
            duration: Infinity,
            action: { label: "View", onClick: () => useUpdates.getState().setDialogOpen(true) },
          });
        })
        .catch((error) => console.warn("Update check failed", error));
    void run();
    const timer = setInterval(run, CHECK_EVERY_MS);
    return () => clearInterval(timer);
    // Re-run when the channel changes, so opting in to release candidates finds one right away.
  }, [checkAutomatically, includeReleaseCandidates]);
}
