"""
Text-to-speech proxy — server-side ElevenLabs integration.

The frontend never holds an ElevenLabs key; it POSTs `{text, voice_id?}` here
and the server reads `ELEVENLABS_API_KEY`, proxies the request to ElevenLabs,
and streams back `audio/mpeg`.

Returns a 503 JSON body `{"error": "tts_unavailable"}` when the key is missing
or the upstream call fails.
"""

import logging
import os

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tts"])

# A pleasant, widely-available default ElevenLabs voice ("Rachel").
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech"


class TTSRequest(BaseModel):
    text: str
    voice_id: str | None = None


def _unavailable(message: str) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": "tts_unavailable", "message": message})


@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return _unavailable("ELEVENLABS_API_KEY is not configured on the server.")

    text = (req.text or "").strip()
    if not text:
        return _unavailable("No text provided.")

    voice_id = (req.voice_id or "").strip() or DEFAULT_VOICE_ID
    url = f"{ELEVENLABS_BASE}/{voice_id}"

    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    try:
        client = httpx.AsyncClient(timeout=60.0)
        resp = await client.post(url, headers=headers, json=payload)

        if resp.status_code != 200:
            await client.aclose()
            logger.error("ElevenLabs TTS error %s: %s", resp.status_code, resp.text[:300])
            return _unavailable(f"ElevenLabs upstream error ({resp.status_code}).")

        async def _stream():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await client.aclose()

        return StreamingResponse(_stream(), media_type="audio/mpeg")

    except Exception as e:
        logger.error("TTS proxy failed: %s", e)
        return _unavailable(f"TTS request failed: {e}")
