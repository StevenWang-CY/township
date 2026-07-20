"""
Audio transcription — real OpenAI Whisper integration.

Reads the server-side `OPENAI_API_KEY`, forwards the uploaded audio bytes to
the OpenAI `whisper-1` transcription endpoint, and returns `{"transcript": ...}`.

When the key is missing or the upstream call fails, returns a 503 JSON body
with `error: "transcription_unavailable"` so the frontend's graceful-degrade
path receives parseable JSON.
"""

import logging
import os

import httpx
from fastapi import APIRouter, UploadFile
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["transcribe"])

OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"


@router.post("/transcribe")
async def transcribe(audio: UploadFile | None = None):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return JSONResponse(
            status_code=503,
            content={
                "transcript": "",
                "error": "transcription_unavailable",
                "message": "OPENAI_API_KEY is not configured on the server.",
            },
        )

    if audio is None:
        return JSONResponse(
            status_code=503,
            content={
                "transcript": "",
                "error": "transcription_unavailable",
                "message": "No audio file was uploaded.",
            },
        )

    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            return JSONResponse(
                status_code=503,
                content={
                    "transcript": "",
                    "error": "transcription_unavailable",
                    "message": "Uploaded audio file was empty.",
                },
            )

        filename = audio.filename or "audio.webm"
        content_type = audio.content_type or "application/octet-stream"

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OPENAI_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, audio_bytes, content_type)},
                data={"model": "whisper-1"},
            )

        if resp.status_code != 200:
            logger.error("Whisper API error %s: %s", resp.status_code, resp.text[:300])
            return JSONResponse(
                status_code=503,
                content={
                    "transcript": "",
                    "error": "transcription_unavailable",
                    "message": f"Whisper upstream error ({resp.status_code}).",
                },
            )

        payload = resp.json()
        return {"transcript": payload.get("text", "")}

    except Exception as e:  # network errors, JSON errors, etc.
        logger.error("Transcription failed: %s", e)
        return JSONResponse(
            status_code=503,
            content={
                "transcript": "",
                "error": "transcription_unavailable",
                "message": f"Transcription failed: {e}",
            },
        )
