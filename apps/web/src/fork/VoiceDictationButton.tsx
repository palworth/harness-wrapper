import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
}) {
  const [state, setState] = useState<"idle" | "listening" | "finishing">("idle");
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const sessionRef = useRef<DictationSession | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onTextRef = useRef(props.onText);
  onTextRef.current = props.onText;

  useEffect(() => () => sessionRef.current?.stop(), []);

  const begin = (apiKey: string) => {
    setState("listening");
    sessionRef.current = startDictation(apiKey, {
      onText: (text, first) => onTextRef.current(text, first),
      onError: (message) =>
        toastManager.add({ type: "error", title: "Dictation stopped", description: message }),
      onEnd: () => {
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
