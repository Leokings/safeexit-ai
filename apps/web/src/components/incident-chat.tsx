"use client";

import { Bot, CornerDownLeft, Database, ShieldCheck, X } from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";

import {
  answerIncidentQuestion,
  generateIncidentReport,
  type AiIncidentContext,
  type GroundedExplanation,
} from "@safeexit/ai";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatMessage =
  | { id: string; role: "USER"; text: string }
  | { id: string; role: "ASSISTANT"; explanation: GroundedExplanation };

const suggestions = [
  "Why is the allowance risky?",
  "Explain the rescue-plan order.",
  "Did any simulation fail?",
  "What is the recorded rescue status?",
] as const;

function ExplanationMessage({ explanation }: { explanation: GroundedExplanation }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={explanation.kind === "REFUSAL" ? "warning" : "success"}>
          {explanation.kind.replaceAll("_", " ")}
        </Badge>
        <Badge variant="neutral">{explanation.severity}</Badge>
      </div>
      <p className="text-sm font-semibold text-foreground">{explanation.headline}</p>
      <div className="mt-3 space-y-3">
        {explanation.statements.map((statement, index) => (
          <div key={`${explanation.kind}:${index}`}>
            <p className="text-sm leading-6 text-muted">{statement.text}</p>
            {statement.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {statement.evidence.map((reference) => (
                  <span
                    key={`${reference.source}:${reference.recordId}:${reference.field ?? "record"}`}
                    className="rounded border border-border bg-background px-1.5 py-1 font-mono text-[9px] text-dim"
                  >
                    {reference.source}:{reference.recordId}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Database className="size-3.5 text-accent" />
        {explanation.toolsUsed.length > 0 ? (
          explanation.toolsUsed.map((tool) => (
            <span key={tool} className="font-mono text-[9px] text-dim">
              {tool}
            </span>
          ))
        ) : (
          <span className="font-mono text-[9px] text-dim">No tool invoked</span>
        )}
      </div>
    </div>
  );
}

export function IncidentChat({
  context,
  onClose,
}: {
  context: AiIncidentContext;
  onClose: () => void;
}) {
  const initialReport = useMemo(() => generateIncidentReport(context), [context]);
  const messageSequence = useRef(0);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "assistant:initial", role: "ASSISTANT", explanation: initialReport },
  ]);

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }

    const response = answerIncidentQuestion({ context, question: trimmed });
    messageSequence.current += 1;
    const messageId = String(messageSequence.current);
    setMessages((current) => [
      ...current,
      { id: `user:${messageId}`, role: "USER", text: trimmed },
      { id: `assistant:${messageId}`, role: "ASSISTANT", explanation: response.explanation },
    ]);
    setInput("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(input);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60" role="presentation">
      <aside
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface shadow-2xl sm:w-[430px]"
        aria-label="Grounded incident assistant"
      >
        <header className="border-b border-border p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-accent/35 bg-accent/10 text-accent">
                <Bot className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Grounded incident assistant</h2>
                <p className="mt-1 text-xs text-muted">Structured evidence only</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close incident assistant"
              title="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="success">Deterministic fallback</Badge>
            <Badge variant="neutral">No model configured</Badge>
            <Badge variant="info">6 allowlisted tools</Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          <div className="space-y-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "border p-4",
                  message.role === "USER"
                    ? "ml-8 border-info/30 bg-info/5"
                    : "mr-3 border-border bg-background",
                )}
              >
                <p className="mb-3 font-mono text-[9px] uppercase text-dim">
                  {message.role === "USER" ? "You" : "SAFEEXIT grounded layer"}
                </p>
                {message.role === "USER" ? (
                  <p className="text-sm leading-6 text-foreground">{message.text}</p>
                ) : (
                  <ExplanationMessage explanation={message.explanation} />
                )}
              </article>
            ))}
          </div>

          {messages.length === 1 && (
            <div className="mt-5">
              <p className="mb-3 font-mono text-[9px] uppercase text-dim">Grounded questions</p>
              <div className="grid gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-border bg-background p-4">
          <form onSubmit={submit} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask about this incident</span>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about evidence, approvals, plan, or status"
                rows={2}
                className="max-h-32 min-h-12 w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-sm leading-5 text-foreground placeholder:text-dim focus:border-accent focus:outline focus:outline-1"
              />
            </label>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send incident question"
              title="Send"
              className="size-12"
            >
              <CornerDownLeft className="size-4" />
            </Button>
          </form>
          <p className="mt-3 flex items-center gap-2 text-[10px] leading-4 text-dim">
            <ShieldCheck className="size-3.5 shrink-0 text-accent" />
            Cannot sign, broadcast, change recipients, or create arbitrary calls.
          </p>
        </footer>
      </aside>
    </div>
  );
}
