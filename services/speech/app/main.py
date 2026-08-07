from __future__ import annotations

import asyncio
import gc
import json
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Final

import gigaam
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("speech-service")

MODEL_NAME: Final = "v3_e2e_rnnt"
MODEL_MAX_DURATION_SECONDS: Final = 24.0
UPLOAD_CHUNK_BYTES: Final = 1024 * 1024
MULTIPART_OVERHEAD_BYTES: Final = 1024 * 1024
SAFE_SUFFIX = re.compile(r"^\.[a-zA-Z0-9]{1,9}$")


def _positive_int_from_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


def _positive_float_from_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc
    if not math.isfinite(value) or value <= 0:
        raise RuntimeError(f"{name} must be a finite number greater than zero")
    return value


@dataclass(frozen=True)
class Settings:
    max_upload_bytes: int
    max_duration_seconds: float
    ffprobe_timeout_seconds: float
    requested_device: str
    model_cache_dir: str | None

    @property
    def max_request_bytes(self) -> int:
        # A multipart body is slightly larger than the file it carries. The file
        # itself is checked independently while being copied to temporary storage.
        return self.max_upload_bytes + MULTIPART_OVERHEAD_BYTES


def load_settings() -> Settings:
    cache_dir = os.getenv("GIGAAM_CACHE_DIR")
    max_duration_seconds = _positive_float_from_env(
        "SPEECH_MAX_DURATION_SECONDS", MODEL_MAX_DURATION_SECONDS
    )
    if max_duration_seconds > MODEL_MAX_DURATION_SECONDS:
        raise RuntimeError(
            "SPEECH_MAX_DURATION_SECONDS must not exceed "
            f"{MODEL_MAX_DURATION_SECONDS:g}"
        )
    return Settings(
        max_upload_bytes=_positive_int_from_env(
            "SPEECH_MAX_UPLOAD_BYTES", 20 * 1024 * 1024
        ),
        max_duration_seconds=max_duration_seconds,
        ffprobe_timeout_seconds=_positive_float_from_env(
            "SPEECH_FFPROBE_TIMEOUT_SECONDS", 10.0
        ),
        requested_device=os.getenv("SPEECH_DEVICE", "auto").strip().lower(),
        model_cache_dir=cache_dir.strip() if cache_dir and cache_dir.strip() else None,
    )


settings = load_settings()


@dataclass
class ModelRuntime:
    model: Any | None = None
    device: str | None = None
    inference_lock: asyncio.Lock | None = None


runtime = ModelRuntime()


class RequestBodyTooLarge(Exception):
    """Raised before Starlette buffers an oversized multipart body."""


class RequestBodyLimitMiddleware:
    """Bound request bodies even when Transfer-Encoding is chunked."""

    def __init__(self, app: ASGIApp, max_bytes: int, limited_path: str) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.limited_path = limited_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") != self.limited_path:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status.HTTP_400_BAD_REQUEST,
                    "Invalid Content-Length",
                )
                return
            if declared_length < 0:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status.HTTP_400_BAD_REQUEST,
                    "Invalid Content-Length",
                )
                return
            if declared_length > self.max_bytes:
                await self._send_too_large(scope, receive, send)
                return

        received_bytes = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.max_bytes:
                    raise RequestBodyTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except RequestBodyTooLarge:
            if response_started:
                raise
            await self._send_too_large(scope, receive, send)

    async def _send_too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._send_error(
            scope,
            receive,
            send,
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Upload is too large",
        )

    @staticmethod
    async def _send_error(
        scope: Scope,
        receive: Receive,
        send: Send,
        status_code: int,
        detail: str,
    ) -> None:
        await JSONResponse(
            status_code=status_code,
            content={"detail": detail},
        )(scope, receive, send)


class AudioProbeError(ValueError):
    pass


def _check_external_tools() -> None:
    missing = [binary for binary in ("ffmpeg", "ffprobe") if not shutil.which(binary)]
    if missing:
        raise RuntimeError(f"Required executable(s) not found: {', '.join(missing)}")


def _resolve_device(requested_device: str) -> str:
    if requested_device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested_device not in {"cpu", "cuda"}:
        raise RuntimeError("SPEECH_DEVICE must be one of: auto, cpu, cuda")
    if requested_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("SPEECH_DEVICE=cuda was requested, but CUDA is unavailable")
    return requested_device


def _load_model(device: str) -> Any:
    kwargs: dict[str, Any] = {
        "device": device,
        "fp16_encoder": device == "cuda",
        "use_flash": False,
    }
    if settings.model_cache_dir is not None:
        kwargs["download_root"] = settings.model_cache_dir
    return gigaam.load_model(MODEL_NAME, **kwargs)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    _check_external_tools()
    device = _resolve_device(settings.requested_device)
    logger.info("Loading %s on %s", MODEL_NAME, device)

    runtime.model = await run_in_threadpool(_load_model, device)
    runtime.device = device
    runtime.inference_lock = asyncio.Lock()
    logger.info("Model %s is ready", MODEL_NAME)

    try:
        yield
    finally:
        runtime.model = None
        runtime.inference_lock = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


app = FastAPI(
    title="Life Balance Speech Service",
    version="1.0.0",
    description="Short Russian voice-message transcription with GigaAM.",
    lifespan=lifespan,
)
app.add_middleware(
    RequestBodyLimitMiddleware,
    max_bytes=settings.max_request_bytes,
    limited_path="/transcribe",
)


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str


class TranscriptionResponse(BaseModel):
    text: str
    duration_seconds: float
    model: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    if runtime.model is None or runtime.device is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not ready",
        )
    return HealthResponse(status="ok", model=MODEL_NAME, device=runtime.device)


def _safe_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix
    return suffix.lower() if SAFE_SUFFIX.fullmatch(suffix) else ".audio"


async def _save_upload(upload: UploadFile, destination: Path) -> int:
    total_bytes = 0
    with destination.open("wb") as output:
        while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
            total_bytes += len(chunk)
            if total_bytes > settings.max_upload_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Upload is too large",
                )
            output.write(chunk)

    if total_bytes == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )
    return total_bytes


def _duration_value(value: object) -> float | None:
    if not isinstance(value, (str, int, float)):
        return None
    try:
        duration = float(value)
    except ValueError:
        return None
    return duration if math.isfinite(duration) and duration > 0 else None


def scan_audio_duration(audio_path: Path) -> float:
    """Decode a bounded prefix when a live browser container has no duration tag."""
    inspection_limit = settings.max_duration_seconds + 1.0
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-progress",
        "pipe:1",
        "-nostats",
        "-i",
        str(audio_path),
        "-map",
        "0:a:0",
        "-t",
        f"{inspection_limit:g}",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=settings.ffprobe_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioProbeError("Audio inspection timed out") from exc

    if result.returncode != 0:
        raise AudioProbeError("ffmpeg could not decode the uploaded file")

    duration = 0.0
    for line in result.stdout.splitlines():
        key, separator, raw_value = line.partition("=")
        if separator and key == "out_time_us":
            try:
                progress_seconds = int(raw_value) / 1_000_000
            except ValueError:
                continue
            if math.isfinite(progress_seconds):
                duration = max(duration, progress_seconds)

    if duration <= 0:
        raise AudioProbeError("Could not determine decoded audio duration")
    return duration


def probe_audio_duration(audio_path: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=duration:format=duration",
        "-of",
        "json",
        str(audio_path),
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=settings.ffprobe_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioProbeError("Audio inspection timed out") from exc

    if result.returncode != 0:
        raise AudioProbeError("ffprobe could not read the uploaded file")

    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise AudioProbeError("ffprobe returned invalid metadata") from exc
    if not isinstance(metadata, dict):
        raise AudioProbeError("ffprobe returned invalid metadata")

    streams = metadata.get("streams")
    if not isinstance(streams, list) or not streams:
        raise AudioProbeError("The uploaded file has no audio stream")
    first_stream = streams[0]
    if not isinstance(first_stream, dict):
        raise AudioProbeError("ffprobe returned invalid stream metadata")

    stream_duration = _duration_value(first_stream.get("duration"))
    format_info = metadata.get("format")
    format_duration = (
        _duration_value(format_info.get("duration"))
        if isinstance(format_info, dict)
        else None
    )
    duration = stream_duration or format_duration
    if duration is None:
        # MediaRecorder usually produces a valid WebM/Ogg stream without a
        # seekable container duration. Decode at most one second beyond the
        # configured limit and use FFmpeg's output timestamp in that case.
        return scan_audio_duration(audio_path)
    return duration


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(file: UploadFile = File(...)) -> TranscriptionResponse:
    if runtime.model is None or runtime.inference_lock is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not ready",
        )

    try:
        with tempfile.TemporaryDirectory(prefix="speech-upload-") as temp_dir:
            audio_path = Path(temp_dir) / f"input{_safe_suffix(file.filename)}"
            await _save_upload(file, audio_path)

            try:
                duration = await run_in_threadpool(probe_audio_duration, audio_path)
            except AudioProbeError as exc:
                logger.info("Rejected invalid audio upload: %s", exc)
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail="Unsupported or invalid audio file",
                ) from exc

            if duration > settings.max_duration_seconds:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Audio duration must not exceed "
                        f"{settings.max_duration_seconds:g} seconds"
                    ),
                )

            try:
                async with runtime.inference_lock:
                    # Starlette/AnyIO waits for the worker thread on cancellation.
                    # This keeps the lock held and the temporary file alive until
                    # GigaAM has actually stopped reading it.
                    result = await run_in_threadpool(
                        runtime.model.transcribe, str(audio_path)
                    )
            except Exception as exc:
                logger.exception("GigaAM transcription failed")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Transcription failed",
                ) from exc

            text = getattr(result, "text", str(result)).strip()
            return TranscriptionResponse(
                text=text,
                duration_seconds=round(duration, 3),
                model=MODEL_NAME,
            )
    finally:
        await file.close()
