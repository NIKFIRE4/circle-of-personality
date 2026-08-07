"use client";

import { Check, LoaderCircle, Mic, Send, Square, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { toZonedInputValue, zonedInputToIso } from "@/lib/calendar-time";

export type VoiceTaskCategory = {
  id: string;
  name: string;
  color?: string;
};

export type VoiceTaskDraft = {
  title: string;
  startAt: string;
  endAt: string;
  categoryId?: string;
  transcript?: string;
  voiceCommandId?: string;
  smartInput?: boolean;
};

type VoiceTaskDialogProps = {
  categories: VoiceTaskCategory[];
  timeZone: string;
  onClose: () => void;
  onSave: (draft: VoiceTaskDraft) => Promise<void>;
  maxDurationSeconds?: number;
};

type Phase = "idle" | "requesting" | "recording" | "transcribing" | "interpreting" | "review" | "saving";

type InterpreterMeta = {
  mode: "ai" | "local";
  model?: string;
  fallbackReason?: "not_configured" | "provider_unavailable";
};

type VoiceResult = {
  transcript: string;
  event: VoiceTaskDraft;
  inputMode: "text" | "voice";
  interpreter?: InterpreterMeta;
};

type TranscriptionPayload = {
  commandId?: unknown;
  transcript?: unknown;
  event?: unknown;
  interpreter?: unknown;
  error?: unknown;
};

type TextInterpretationPayload = {
  text?: unknown;
  event?: unknown;
  interpreter?: unknown;
  error?: unknown;
};

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function VoiceTaskDialog({
  categories,
  timeZone,
  onClose,
  onSave,
  maxDurationSeconds = 20,
}: VoiceTaskDialogProps) {
  const durationSeconds = Math.max(1, Math.min(20, maxDurationSeconds));
  const [phase, setPhase] = useState<Phase>("idle");
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [reviewDraft, setReviewDraft] = useState<VoiceTaskDraft | null>(null);
  const [textCommand, setTextCommand] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startInFlightRef.current = false;
      uploadAbortRef.current?.abort();
      discardRecording(
        recorderRef,
        streamRef,
        chunksRef,
        stopTimerRef,
        countdownRef,
      );
    };
  }, []);

  async function interpretTextCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = textCommand.trim();
    if (!text || phase !== "idle") return;

    setPhase("interpreting");
    setError("");
    setResult(null);
    setReviewDraft(null);
    setPartialTranscript("");
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const response = await fetch("/api/task-commands/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as TextInterpretationPayload;
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      if (!isVoiceTaskDraft(payload.event)) {
        throw new Error("Сервис вернул неполный результат. Попробуйте ещё раз.");
      }

      if (mountedRef.current) {
        const nextResult: VoiceResult = {
          transcript: typeof payload.text === "string" ? payload.text : text,
          event: { ...payload.event, transcript: text, smartInput: true },
          inputMode: "text",
          interpreter: interpreterMeta(payload.interpreter),
        };
        setResult(nextResult);
        setReviewDraft(editableDraft(nextResult.event, timeZone));
        setPhase("review");
      }
    } catch (cause) {
      if (mountedRef.current && !controller.signal.aborted) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "Не удалось разобрать задачу.");
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
    }
  }

  async function startRecording() {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setError("");
    setResult(null);
    setReviewDraft(null);
    setPartialTranscript("");

    if (!window.isSecureContext) {
      startInFlightRef.current = false;
      setPhase("idle");
      setError("Микрофон доступен только через HTTPS или на localhost.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      startInFlightRef.current = false;
      setPhase("idle");
      setError("Этот браузер не поддерживает запись с микрофона.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      startInFlightRef.current = false;
      setPhase("idle");
      setError("Запись голоса не поддерживается этим браузером. Попробуйте обновить его.");
      return;
    }

    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (cause) {
      startInFlightRef.current = false;
      setPhase("idle");
      setError(microphoneErrorMessage(cause));
      return;
    }

    if (!mountedRef.current) {
      startInFlightRef.current = false;
      stopTracks(stream);
      return;
    }

    let mediaRecorder: MediaRecorder;
    try {
      const mimeType = preferredMimeType();
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      startInFlightRef.current = false;
      stopTracks(stream);
      setPhase("idle");
      setError("Не удалось начать запись в этом браузере.");
      return;
    }

    chunksRef.current = [];
    recorderRef.current = mediaRecorder;
    streamRef.current = stream;
    setRemainingSeconds(durationSeconds);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    mediaRecorder.onerror = () => {
      startInFlightRef.current = false;
      discardRecording(
        recorderRef,
        streamRef,
        chunksRef,
        stopTimerRef,
        countdownRef,
      );
      if (mountedRef.current) {
        setPhase("idle");
        setError("Запись прервалась. Проверьте микрофон и попробуйте ещё раз.");
      }
    };
    mediaRecorder.onstop = () => {
      void transcribeRecording(mediaRecorder);
    };

    try {
      mediaRecorder.start(1_000);
      setPhase("recording");
      countdownRef.current = window.setInterval(() => {
        setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
      }, 1_000);
      stopTimerRef.current = window.setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          startInFlightRef.current = false;
          if (mountedRef.current) setPhase("transcribing");
          mediaRecorder.stop();
        }
      }, durationSeconds * 1_000);
    } catch {
      startInFlightRef.current = false;
      discardRecording(
        recorderRef,
        streamRef,
        chunksRef,
        stopTimerRef,
        countdownRef,
      );
      setPhase("idle");
      setError("Не удалось начать запись. Попробуйте ещё раз.");
    }
  }

  function stopRecording() {
    clearCaptureTimers(stopTimerRef, countdownRef);
    const recorder = recorderRef.current;
    if (recorder?.state === "recording" || recorder?.state === "paused") {
      startInFlightRef.current = false;
      setPhase("transcribing");
      recorder.stop();
    }
  }

  async function transcribeRecording(mediaRecorder: MediaRecorder) {
    startInFlightRef.current = false;
    clearCaptureTimers(stopTimerRef, countdownRef);
    if (recorderRef.current === mediaRecorder) recorderRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!mountedRef.current) return;

    const mimeType = mediaRecorder.mimeType || chunks[0]?.type || "audio/webm";
    const audio = new Blob(chunks, { type: mimeType });
    if (audio.size === 0) {
      setPhase("idle");
      setError("Запись получилась пустой. Проверьте микрофон и попробуйте ещё раз.");
      return;
    }

    setPhase("transcribing");
    setError("");
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const data = new FormData();
      data.append("file", audio, `command.${extensionForMimeType(mimeType)}`);
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as TranscriptionPayload;

      if (!response.ok) {
        const transcript = apiErrorTranscript(payload);
        if (transcript) setPartialTranscript(transcript);
        throw new Error(apiErrorMessage(payload));
      }
      if (
        typeof payload.commandId !== "string" ||
        typeof payload.transcript !== "string" ||
        !isVoiceTaskDraft(payload.event)
      ) {
        throw new Error("Сервис вернул неполный результат. Попробуйте ещё раз.");
      }

      if (mountedRef.current) {
        setPartialTranscript("");
        const nextResult: VoiceResult = {
          transcript: payload.transcript,
          event: {
            ...payload.event,
            transcript: payload.transcript,
            voiceCommandId: payload.commandId,
            smartInput: true,
          },
          inputMode: "voice",
          interpreter: interpreterMeta(payload.interpreter),
        };
        setResult(nextResult);
        setReviewDraft(editableDraft(nextResult.event, timeZone));
        setPhase("review");
      }
    } catch (cause) {
      if (mountedRef.current && !controller.signal.aborted) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "Не удалось распознать речь.");
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
    }
  }

  async function confirmResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewDraft || phase === "saving") return;

    const title = reviewDraft.title.trim();
    const startAt = zonedInputToIso(reviewDraft.startAt, timeZone);
    const endAt = zonedInputToIso(reviewDraft.endAt, timeZone);
    if (!title) {
      setError("Укажите название события.");
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError("Время завершения должно быть позже времени начала.");
      return;
    }

    setPhase("saving");
    setError("");

    try {
      await onSave({ ...reviewDraft, title });
      if (mountedRef.current) setPhase("idle");
    } catch (cause) {
      if (mountedRef.current) {
        setPhase("review");
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить задачу.");
      }
    }
  }

  function closeDialog() {
    startInFlightRef.current = false;
    uploadAbortRef.current?.abort();
    discardRecording(
      recorderRef,
      streamRef,
      chunksRef,
      stopTimerRef,
      countdownRef,
    );
    onClose();
  }

  const recording = phase === "recording";
  const busy = phase === "requesting"
    || phase === "transcribing"
    || phase === "interpreting"
    || phase === "saving";
  const recorderDisabled = phase !== "idle" && !recording;
  const statusTitle = phase === "requesting"
    ? "Ждём разрешение на микрофон"
    : recording
      ? "Идёт запись"
      : phase === "transcribing"
        ? "Распознаём речь"
        : phase === "interpreting"
          ? "ИИ разбирает задачу"
        : phase === "review"
          ? result?.inputMode === "voice" ? "Запись распознана" : "Задача разобрана"
          : phase === "saving"
            ? "Создаём событие"
            : "Готово к вводу";
  const statusDetail = phase === "requesting"
    ? "Ответьте на запрос браузера. После разрешения запись начнётся автоматически."
    : recording
      ? "Микрофон включён. Нажмите квадрат, когда закончите говорить."
      : phase === "transcribing"
        ? "Запись получена: распознаём речь, тип задачи и время."
        : phase === "interpreting"
          ? "Определяем название, время и подходящую сферу жизни."
        : phase === "review"
          ? "Проверьте текст, задачу и время перед сохранением."
          : phase === "saving"
            ? "Подтверждённая задача сохраняется в календаре."
            : "Напишите задачу обычной фразой или нажмите на микрофон.";
  const hint = recording
    ? `Говорите · осталось ${remainingSeconds} сек.`
    : phase === "idle"
      ? "Например: «Поставь на эту пятницу с тринадцати до семнадцати танцы»"
      : "";

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="voice-task-title" aria-busy={busy}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Текст или голос</span>
            <h2 id="voice-task-title">Умная задача</h2>
          </div>
          <button type="button" className="modal-close" onClick={closeDialog} aria-label="Закрыть умный ввод">
            <X size={15} />
          </button>
        </div>

        <div className="voice-recorder" data-phase={phase}>
          {phase === "idle" && (
            <form className="smart-command-form" onSubmit={(event) => void interpretTextCommand(event)}>
              <label htmlFor="smart-task-command">Опишите задачу одной фразой</label>
              <div>
                <input
                  id="smart-task-command"
                  value={textCommand}
                  onChange={(event) => setTextCommand(event.target.value)}
                  placeholder="Тренировка с 13 до 15 послезавтра"
                  maxLength={1_000}
                  autoComplete="off"
                />
                <button type="submit" aria-label="Разобрать задачу" disabled={!textCommand.trim()}>
                  <Send size={16} />
                </button>
              </div>
            </form>
          )}
          {phase === "idle" && <div className="smart-command-divider"><span>или продиктуйте</span></div>}
          <div className="record-orbit" data-phase={phase}>
            <button
              type="button"
              className={`record-button ${recording ? "recording" : ""} ${busy ? "processing" : ""} ${phase === "review" ? "complete" : ""}`}
              onClick={recording ? stopRecording : () => void startRecording()}
              disabled={recorderDisabled}
              aria-label={recording ? "Остановить запись" : phase === "review" ? "Запись распознана" : "Начать запись"}
              aria-pressed={recording}
              aria-busy={busy}
            >
              {busy
                ? <LoaderCircle className="voice-spinner" size={25} />
                : phase === "review"
                  ? <Check size={27} />
                  : recording
                    ? <Square size={19} fill="currentColor" />
                    : <Mic size={26} />}
            </button>
          </div>
          <div className="voice-status" data-phase={phase} role="status" aria-live="polite" aria-atomic="true">
            <i className="voice-status-dot" aria-hidden="true" />
            <div><strong>{statusTitle}</strong><span>{statusDetail}</span></div>
          </div>
          {recording && (
            <div className="voice-progress" aria-hidden="true">
              <span style={{ width: `${((durationSeconds - remainingSeconds) / durationSeconds) * 100}%` }} />
            </div>
          )}
          {hint && <p className="voice-hint">{hint}</p>}
          {error && <div className="auth-error voice-error" role="alert">{error}</div>}
          {partialTranscript && !result && (
            <div className="voice-preview voice-preview-partial" role="status">
              <span className="voice-preview-label">Микрофон сработал · распознано</span>
              <p>«{partialTranscript}»</p>
              <span className="voice-preview-note">Речь получена, но дату или время определить не удалось. Повторите команду с диапазоном «с … до …».</span>
            </div>
          )}
          {result && reviewDraft && (
            <div className="voice-preview" role="status">
              <span className="voice-preview-label">
                {result.inputMode === "voice" ? "Распознано" : "Разобрано"}
              </span>
              <p>«{result.transcript}»</p>
              <form id="voice-review-form" className="voice-review-form" onSubmit={(event) => void confirmResult(event)}>
                <div className="voice-review-grid">
                  <label className="full">
                    <span>Название</span>
                    <input
                      value={reviewDraft.title}
                      onChange={(event) => setReviewDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)}
                      maxLength={200}
                      required
                    />
                  </label>
                  <label>
                    <span>Начало</span>
                    <input
                      type="datetime-local"
                      value={reviewDraft.startAt}
                      onChange={(event) => setReviewDraft((draft) => draft ? { ...draft, startAt: event.target.value } : draft)}
                      required
                    />
                  </label>
                  <label>
                    <span>Завершение</span>
                    <input
                      type="datetime-local"
                      value={reviewDraft.endAt}
                      min={reviewDraft.startAt}
                      onChange={(event) => setReviewDraft((draft) => draft ? { ...draft, endAt: event.target.value } : draft)}
                      required
                    />
                  </label>
                  <label className="full">
                    <span>Сфера жизни</span>
                    <select
                      value={reviewDraft.categoryId ?? ""}
                      onChange={(event) => setReviewDraft((draft) => draft ? { ...draft, categoryId: event.target.value || undefined } : draft)}
                    >
                      <option value="">Без сферы</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                </div>
              </form>
              {result.interpreter && (
                <span className="voice-preview-note">
                  {interpreterLabel(result.interpreter)}
                </span>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setResult(null);
                setReviewDraft(null);
                setPartialTranscript("");
                setError("");
                setPhase("idle");
              }}
              disabled={busy}
            >
              Повторить
            </button>
            <button type="submit" form="voice-review-form" className="primary-button" disabled={busy}>
              {phase === "saving" ? "Сохраняем…" : "Подтвердить"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  return "webm";
}

function microphoneErrorMessage(cause: unknown): string {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
      return "Разрешите доступ к микрофону в настройках браузера.";
    }
    if (cause.name === "NotFoundError" || cause.name === "DevicesNotFoundError") {
      return "Микрофон не найден. Подключите его и попробуйте ещё раз.";
    }
    if (cause.name === "NotReadableError" || cause.name === "TrackStartError") {
      return "Микрофон занят другим приложением или недоступен.";
    }
  }
  return "Не удалось получить доступ к микрофону.";
}

function apiErrorMessage(payload: TranscriptionPayload | TextInterpretationPayload): string {
  if (
    payload.error &&
    typeof payload.error === "object" &&
    "code" in payload.error &&
    payload.error.code === "UNTRUSTED_ORIGIN"
  ) {
    return "Откройте приложение по адресу из APP_URL (обычно http://localhost:3000) и повторите запись.";
  }
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message;
  }
  return "Не удалось распознать речь. Попробуйте ещё раз.";
}

function apiErrorTranscript(payload: TranscriptionPayload): string {
  if (!payload.error || typeof payload.error !== "object" || !("details" in payload.error)) return "";
  const details = payload.error.details;
  if (!details || typeof details !== "object" || !("transcript" in details)) return "";
  return typeof details.transcript === "string" ? details.transcript.trim() : "";
}

function editableDraft(draft: VoiceTaskDraft, timeZone: string): VoiceTaskDraft {
  return {
    ...draft,
    startAt: toZonedInputValue(draft.startAt, timeZone, false),
    endAt: toZonedInputValue(draft.endAt, timeZone, false),
  };
}

function isVoiceTaskDraft(value: unknown): value is VoiceTaskDraft {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.title === "string" &&
    event.title.trim().length > 0 &&
    typeof event.startAt === "string" &&
    !Number.isNaN(new Date(event.startAt).getTime()) &&
    typeof event.endAt === "string" &&
    !Number.isNaN(new Date(event.endAt).getTime())
  );
}

function interpreterMeta(value: unknown): InterpreterMeta | undefined {
  if (!value || typeof value !== "object" || !("mode" in value)) return undefined;
  const meta = value as Record<string, unknown>;
  if (meta.mode !== "ai" && meta.mode !== "local") return undefined;
  return {
    mode: meta.mode,
    ...(typeof meta.model === "string"
      ? { model: meta.model }
      : {}),
    ...(meta.mode === "local"
      && (meta.fallbackReason === "not_configured" || meta.fallbackReason === "provider_unavailable")
      ? { fallbackReason: meta.fallbackReason }
      : {}),
  };
}

function interpreterLabel(interpreter: InterpreterMeta): string {
  if (interpreter.mode === "ai") {
    const model = interpreter.model?.split("/").pop()?.replace(/:free$/i, "");
    return model ? `Разобрано ИИ · ${model}` : "Разобрано ИИ";
  }
  if (interpreter.fallbackReason === "provider_unavailable") {
    return "ИИ временно недоступен · использован локальный разбор";
  }
  return "ИИ-ключ не настроен · использован локальный разбор";
}

function discardRecording(
  recorderRef: MutableRef<MediaRecorder | null>,
  streamRef: MutableRef<MediaStream | null>,
  chunksRef: MutableRef<Blob[]>,
  stopTimerRef: MutableRef<number | null>,
  countdownRef: MutableRef<number | null>,
) {
  clearCaptureTimers(stopTimerRef, countdownRef);
  const recorder = recorderRef.current;
  recorderRef.current = null;
  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    if (recorder.state !== "inactive") recorder.stop();
  }
  chunksRef.current = [];
  stopTracks(streamRef.current);
  streamRef.current = null;
}

function clearCaptureTimers(
  stopTimerRef: MutableRef<number | null>,
  countdownRef: MutableRef<number | null>,
) {
  if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
  if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
  stopTimerRef.current = null;
  countdownRef.current = null;
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

type MutableRef<T> = { current: T };
