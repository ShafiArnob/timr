"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function useCopy() {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // The button outlives the timeout, so clear it rather than leak a
      // setState into an unmounted tree when a tab is switched mid-flight.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }, []);

  return { copied, copy };
}

/** Copy affordance for a single value, used inline beside the base URL. */
export function CopyValue({ value, label }: { value: string; label?: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
        {value}
      </code>
      <Button
        variant="outline"
        size="icon"
        onClick={() => copy(value)}
        aria-label={label ?? "Copy"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

export function CodeBlock({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <div className={cn("group/code relative", className)}>
      {/* Capped so a long sketch scrolls inside its own box instead of
          burying the rest of the page. */}
      <pre className="max-h-128 overflow-auto rounded-lg border bg-muted p-4 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
      <Button
        variant="outline"
        size="icon-sm"
        // Pinned over the scroll container so it stays put while code scrolls.
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
        onClick={() => copy(code)}
        aria-label="Copy code"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

export type CodeTab = { value: string; label: string; code: string };

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  return (
    <Tabs defaultValue={tabs[0]?.value}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <CodeBlock code={tab.code} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
