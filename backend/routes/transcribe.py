"""
Audio transcription stub.

Returns a 200 JSON body with `error: "transcription_unavailable"` so the
frontend's graceful-degrade path receives parseable JSON instead of a 404
or 501 with no body.

Wire a real Whisper integration here when ready.
"""

from typing import Optional

from fastapi import APIRouter, UploadFile

router = APIRouter(prefix="/api", tags=["transcribe"])


@router.post("/transcribe")
async def transcribe(audio: Optional[UploadFile] = None):
    return {
        "transcript": "",
        "error": "transcription_unavailable",
        "message": "Whisper transcription is not yet wired.",
    }
