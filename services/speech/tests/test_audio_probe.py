from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.main import AudioProbeError, probe_audio_duration


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"),
    "FFmpeg is required",
)
class AudioProbeTests(unittest.TestCase):
    def test_accepts_live_webm_without_container_duration(self) -> None:
        with tempfile.TemporaryDirectory(prefix="speech-test-") as temp_dir:
            audio_path = Path(temp_dir) / "media-recorder.webm"
            generated = subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=2",
                    "-c:a",
                    "libopus",
                    "-f",
                    "webm",
                    "pipe:1",
                ],
                capture_output=True,
                check=True,
                timeout=10,
            )
            audio_path.write_bytes(generated.stdout)

            metadata_result = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=duration:format=duration",
                    "-of",
                    "json",
                    str(audio_path),
                ],
                capture_output=True,
                check=True,
                encoding="utf-8",
                timeout=10,
            )
            metadata = json.loads(metadata_result.stdout)

            self.assertNotIn("duration", metadata.get("format", {}))
            self.assertAlmostEqual(probe_audio_duration(audio_path), 2.0, delta=0.1)

    def test_rejects_non_audio_bytes(self) -> None:
        with tempfile.TemporaryDirectory(prefix="speech-test-") as temp_dir:
            audio_path = Path(temp_dir) / "invalid.webm"
            audio_path.write_bytes(b"this is not an audio stream")

            with self.assertRaises(AudioProbeError):
                probe_audio_duration(audio_path)


if __name__ == "__main__":
    unittest.main()
