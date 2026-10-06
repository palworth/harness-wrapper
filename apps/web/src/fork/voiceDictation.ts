/**
 * Live dictation through OpenAI's Realtime transcription API (fork-only; see FORK.md).
 *
 * The microphone is streamed as 24 kHz PCM16 over a WebSocket and every
 * `...transcription.delta` is handed to `onText` as it arrives, so words land
 * in the composer while you are still talking. Stopping commits the buffer and
 * waits briefly for the final transcript before closing the socket.
 *
 * The API key lives in this browser profile's localStorage and is sent straight
 * to api.openai.com — fine for a personal build, not for a shared deployment.
 */

const API_KEY_STORAGE_KEY = "oc-ui:openai-api-key";
const MODEL_STORAGE_KEY = "oc-ui:transcription-model";
const DEFAULT_MODEL = "gpt-live-transcribe";
const SAMPLE_RATE = 24_000;
// How long to wait for the final transcript after the user stops talking.
const FINALIZE_TIMEOUT_MS = 5_000;

// VITE_OPENAI_API_KEY from apps/web/.env.local (gitignored) is the default in dev builds only;
// a key saved in the app takes precedence. Gating on DEV lets production builds drop the key.
const ENV_API_KEY = import.meta.env.DEV
  ? ((import.meta.env as Record<string, string | undefined>).VITE_OPENAI_API_KEY?.trim() ?? "")
  : "";

export function readOpenAiApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() || ENV_API_KEY;
}

export function writeOpenAiApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
  else localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export interface DictationCallbacks {
  /** Newly transcribed text, in order. `first` is true for the first chunk of a session. */
  onText: (text: string, first: boolean) => void;
  onError: (message: string) => void;
  /** The session fully ended (finalized, failed, or cancelled). */
  onEnd: () => void;
}

export interface DictationSession {
  /** Stop listening and flush the final transcript. */
  stop: () => void;
  /** Tear everything down immediately: release the mic, close the socket, fire no more callbacks. */
  cancel: () => void;
}

function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function startDictation(apiKey: string, callbacks: DictationCallbacks): DictationSession {
  const model = localStorage.getItem(MODEL_STORAGE_KEY)?.trim() || DEFAULT_MODEL;
  const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", [
    "realtime",
    `openai-insecure-api-key.${apiKey}`,
  ]);
  const pending: string[] = [];
  let micStream: MediaStream | null = null;
  let micContext: AudioContext | null = null;
  let ended = false;
  let silent = false;
  let stopping = false;
  let sentAudio = false;
  let sawText = false;
  let finalizeTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (event: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };

  const releaseMic = () => {
    for (const track of micStream?.getTracks() ?? []) track.stop();
    micStream = null;
    if (micContext) void micContext.close().catch(() => undefined);
    micContext = null;
  };

  const end = (error?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(finalizeTimer);
    releaseMic();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    if (silent) return;
    if (error) callbacks.onError(error);
    callbacks.onEnd();
  };

  ws.addEventListener("open", () => {
    send({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            transcription: { model, delay: "low" },
            turn_detection: null,
          },
        },
      },
    });
    for (const chunk of pending.splice(0))
      send({ type: "input_audio_buffer.append", audio: chunk });
    if (stopping) finalize();
  });

  ws.addEventListener("message", (message) => {
    if (ended) return;
    let event: { type?: string; delta?: string; error?: { message?: string } };
    try {
      event = JSON.parse(String(message.data));
    } catch {
      return;
    }
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        {
          // The first delta carries a leading space; the composer adds its own boundary.
          const text = sawText ? event.delta : event.delta?.trimStart();
          if (text) {
            callbacks.onText(text, !sawText);
            sawText = true;
          }
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (stopping) end();
        break;
      case "error":
        end(event.error?.message ?? "OpenAI returned an error.");
        break;
    }
  });

  ws.addEventListener("error", () => end("Couldn't connect to OpenAI. Check the API key."));
  ws.addEventListener("close", (event) => {
    if (!ended) end(stopping ? undefined : event.reason || "The transcription connection closed.");
  });

  const finalize = () => {
    if (ended) return;
    if (!sentAudio) return end(); // nothing to transcribe; also closes a still-connecting socket
    clearTimeout(finalizeTimer);
    // Bounds finalization in every socket state, including one that never finishes connecting.
    finalizeTimer = setTimeout(() => end(), FINALIZE_TIMEOUT_MS);
    if (ws.readyState === WebSocket.OPEN) send({ type: "input_audio_buffer.commit" });
    // Otherwise still connecting: the open handler flushes the audio and calls back here.
  };

  void (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      // Tracked immediately so every failure path below releases the mic.
      micStream = stream;
      if (ended || stopping) {
        releaseMic();
        return;
      }
      // The context resamples the mic to the rate the API expects.
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      micContext = context;
      const source = context.createMediaStreamSource(stream);
      // ScriptProcessor keeps this to one file: an AudioWorklet would need its own module URL.
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (stopping) return;
        const chunk = pcm16Base64(event.inputBuffer.getChannelData(0));
        sentAudio = true;
        if (ws.readyState === WebSocket.OPEN)
          send({ type: "input_audio_buffer.append", audio: chunk });
        else pending.push(chunk);
      };
      source.connect(processor);
      processor.connect(context.destination);
    } catch (error) {
      releaseMic();
      end(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied."
          : "Couldn't start the microphone.",
      );
    }
  })();

  return {
    stop: () => {
      if (stopping || ended) return;
      stopping = true;
      releaseMic();
      finalize();
    },
    cancel: () => {
      if (ended) return;
      silent = true;
      stopping = true;
      end();
    },
  };
}
