import { MicIcon, SquareIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTitle } from "~/components/ui/popover";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import {
  type DictationSession,
  readOpenAiApiKey,
  startDictation,
  writeOpenAiApiKey,
} from "./voiceDictation";

/**
 * Mic button beside the composer's paperclip (fork-only; see FORK.md). Click to
 * dictate, click again to stop; right-click to change the OpenAI API key.
 */
export function VoiceDictationButton(props: {
  /** Type transcribed text at the composer caret. */
  onText: (text: string, first: boolean) => void;
  disabled?: boolean;
  /** Identifies the thread/draft the composer is bound to; changing it cancels dictation. */
  targetKey: string;
}) {
  const [state, setState] = useState<"idle" | "listening" | "finishing">("idle");
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const sessionRef = useRef<DictationSession | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onTextRef = useRef(props.onText);
  const targetKeyRef = useRef(props.targetKey);
  // Layout effect, not render: the target-switch cancel below also runs before paint, so a queued
  // flush can never deliver one thread's transcript through another thread's callback.
  useLayoutEffect(() => {
    onTextRef.current = props.onText;
    targetKeyRef.current = props.targetKey;
  });

  // Deltas are buffered and inserted at most once per frame: the composer only syncs its caret
  // with the prompt after React commits, so back-to-back inserts would land at a stale caret.
  // Each chunk is stamped with its session id and start target; a flush drops chunks that no
  // longer match the live session/target.
  const bufferRef = useRef<{
    text: string;
    first: boolean;
    sessionId: number;
    targetKey: string;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextSessionIdRef = useRef(0);
  const activeSessionIdRef = useRef(0); // 0 = no live session

  const dropBuffer = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    frameRef.current = null;
    bufferRef.current = null;
  };

  const flushBuffer = () => {
    const buffered = bufferRef.current;
    dropBuffer();
    if (
      buffered &&
      buffered.sessionId === activeSessionIdRef.current &&
      buffered.targetKey === targetKeyRef.current
    ) {
      onTextRef.current(buffered.text, buffered.first);
    }
  };

  const cancelSession = () => {
    activeSessionIdRef.current = 0;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    dropBuffer();
    setState("idle");
  };
  const cancelSessionRef = useRef(cancelSession);
  useLayoutEffect(() => {
    cancelSessionRef.current = cancelSession;
  });

  // A session belongs to the thread/draft it started in: cancel when that changes and on unmount.
  useLayoutEffect(() => () => cancelSessionRef.current(), [props.targetKey]);

  // A composer that stops accepting input must not keep recording into it.
  useLayoutEffect(() => {
    if (props.disabled && sessionRef.current) cancelSessionRef.current();
  }, [props.disabled]);

  const begin = (apiKey: string) => {
    setState("listening");
    const sessionId = ++nextSessionIdRef.current;
    const targetKey = targetKeyRef.current;
    activeSessionIdRef.current = sessionId;
    sessionRef.current = startDictation(apiKey, {
      onText: (text, first) => {
        const buffered = bufferRef.current;
        bufferRef.current = {
          text: (buffered?.text ?? "") + text,
          first: (buffered?.first ?? false) || first,
          sessionId,
          targetKey,
        };
        frameRef.current ??= requestAnimationFrame(flushBuffer);
        // rAF is paused while the Electron window is hidden; don't let text sit there.
        timerRef.current ??= setTimeout(flushBuffer, 250);
      },
      onError: (message) =>
        toastManager.add({ type: "error", title: "Dictation stopped", description: message }),
      onEnd: () => {
        flushBuffer(); // deliver anything still queued before reporting the end
        if (activeSessionIdRef.current === sessionId) activeSessionIdRef.current = 0;
        sessionRef.current = null;
        setState("idle");
      },
    });
  };

  const openKeyDialog = () => {
    setKeyDraft(readOpenAiApiKey());
    setKeyDialogOpen(true);
  };

  const toggle = () => {
    if (state === "listening") {
      setState("finishing");
      sessionRef.current?.stop();
      return;
    }
    if (state === "finishing") return;
    const apiKey = readOpenAiApiKey();
    if (apiKey) begin(apiKey);
    else openKeyDialog();
  };

  const saveKey = () => {
    writeOpenAiApiKey(keyDraft);
    setKeyDialogOpen(false);
    const apiKey = readOpenAiApiKey();
    if (apiKey && state === "idle") begin(apiKey);
  };

  const label =
    state === "listening"
      ? "Stop dictation"
      : state === "finishing"
        ? "Finishing transcript…"
        : "Dictate (right-click for API key)";

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={buttonRef}
              type="button"
              variant={state === "idle" ? "ghost" : "ghost-destructive"}
              size="icon-sm"
              disabled={props.disabled && state === "idle"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toggle}
              onContextMenu={(event) => {
                event.preventDefault();
                openKeyDialog();
              }}
              aria-label={label}
              aria-pressed={state !== "idle"}
            />
          }
        >
          {state === "idle" ? <MicIcon /> : <SquareIcon className="animate-pulse fill-current" />}
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <Popover open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <PopoverPopup anchor={buttonRef} side="top" width="md">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              // React bubbles events out of portals, and the composer is itself a <form>:
              // without this, saving the key would also send the draft.
              event.stopPropagation();
              saveKey();
            }}
          >
            <PopoverTitle>OpenAI API key</PopoverTitle>
            <p className="text-muted-foreground text-xs">
              Used for voice dictation. Stored only in this app's local storage. Leave empty to
              remove it.
            </p>
            <Input
              type="password"
              autoFocus
              placeholder="sk-…"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.currentTarget.value)}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </PopoverPopup>
      </Popover>
    </>
  );
}
