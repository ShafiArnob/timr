"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createApiKey,
  deleteApiKey,
  regenerateApiKey,
  type ApiKeyTokenResult,
} from "./actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Computed on the server so the client can't disagree about "now". */
  expired: boolean;
};

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

/**
 * Fixed locale and the user's saved zone, so the server and client render
 * identical markup.
 */
function formatDate(iso: string | null, timeZone: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // No cleanup needed: the dialog unmounts this well before it matters.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the key and copy it manually.");
    }
  }

  return (
    <Button variant="outline" size="icon" onClick={handleCopy} aria-label="Copy key">
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** The one and only chance to see the plaintext token. */
function TokenDialog({
  token,
  name,
  onClose,
}: {
  token: string | null;
  name: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={token !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy your key now</DialogTitle>
          <DialogDescription>
            This is the only time <span className="font-medium">{name}</span>{" "}
            will be shown. We store a hash, not the key itself — if you lose it,
            regenerate to get a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
            {token}
          </code>
          {token ? <CopyButton value={token} /> : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateKeyDialog({
  onCreated,
}: {
  onCreated: (result: { token: string; name: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [expiry, setExpiry] = React.useState("never");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setError(null);
    if (next) {
      setName("");
      setExpiry("never");
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result: ApiKeyTokenResult = await createApiKey(formData);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(false);
      onCreated({ token: result.token, name: result.name });
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Create key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            The key is shown once, right after it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form id="create-api-key" onSubmit={handleSubmit} className="grid gap-4">
          <input type="hidden" name="expiry" value={expiry} />
          <div className="grid gap-2">
            <Label htmlFor="api-key-name">Name</Label>
            <Input
              id="api-key-name"
              name="name"
              placeholder="CI pipeline"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="api-key-expiry">Expires</Label>
            <Select
              value={expiry}
              onValueChange={(value) => setExpiry(String(value))}
              items={EXPIRY_OPTIONS}
            >
              <SelectTrigger id="api-key-expiry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form="create-api-key"
            disabled={pending || name.trim().length === 0}
          >
            {pending ? "Creating…" : "Create key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateButton({
  apiKey,
  onRegenerated,
}: {
  apiKey: ApiKeyRow;
  onRegenerated: (result: { token: string; name: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateApiKey(apiKey.id);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(false);
      onRegenerated({ token: result.token, name: result.name });
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <RefreshCwIcon />
        <span className="sr-only">Regenerate key</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate {apiKey.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The current key stops working immediately, and anything still using
            it will start failing until you swap in the new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={handleRegenerate}>
            {pending ? "Regenerating…" : "Regenerate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteButton({ apiKey }: { apiKey: ApiKeyRow }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteApiKey(apiKey.id);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast.success(`${apiKey.name} deleted.`);
      setOpen(false);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2Icon />
        <span className="sr-only">Delete key</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {apiKey.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything calling the API with this key stops working immediately.
            This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ApiKeys({
  keys,
  timezone,
}: {
  keys: ApiKeyRow[];
  timezone: string | null;
}) {
  const [issued, setIssued] = React.useState<{
    token: string;
    name: string;
  } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {keys.length === 0
            ? "No keys yet."
            : `${keys.length} key${keys.length === 1 ? "" : "s"}`}
        </p>
        <CreateKeyDialog onCreated={setIssued} />
      </div>

      {keys.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-medium">{apiKey.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {apiKey.prefix}…
                  </TableCell>
                  <TableCell>{formatDate(apiKey.createdAt, timezone)}</TableCell>
                  <TableCell>
                    {formatDate(apiKey.lastUsedAt, timezone)}
                  </TableCell>
                  <TableCell>
                    {apiKey.expired ? (
                      <Badge variant="outline" className="text-destructive">
                        Expired
                      </Badge>
                    ) : apiKey.expiresAt === null ? (
                      "Never"
                    ) : (
                      formatDate(apiKey.expiresAt, timezone)
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <RegenerateButton
                        apiKey={apiKey}
                        onRegenerated={setIssued}
                      />
                      <DeleteButton apiKey={apiKey} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <TokenDialog
        token={issued?.token ?? null}
        name={issued?.name ?? ""}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}
