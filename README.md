# Voice Call Bot

This is a minimal outbound call bot with two separate dialogue variants:

1. Your server places a phone call.
2. Twilio streams the callee's speech over WebSocket.
3. Sarvam STT transcribes speech in real time.
4. The scripted engine picks the next reply.
5. Sarvam TTS generates expressive audio.
6. Twilio plays that audio back on the call.

## Setup

Install dependencies:

```bash
npm install
```

Create environment variables:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `PUBLIC_BASE_URL`
- `SARVAM_API_KEY` if needed by your Sarvam endpoint
- `PORT_A` and `PORT_B` if you want to override the default ports

`PUBLIC_BASE_URL` must be a public URL such as an ngrok tunnel.
Use one tunnel per script, and point `PUBLIC_BASE_URL` at the matching tunnel URL.

You can copy `.env.example` to `.env` and fill in the values.

## Run

```bash
npm run start:a
```

To run the second variant:

```bash
npm run start:b
```

## Start a call

Send a POST request to `/call` on the script you started:

```bash
curl -X POST http://localhost:3001/call -H "Content-Type: application/json" -d "{\"to\":\"+1234567890\"}"
```

For the second script, use `3002` instead.

## Voice flow

- Server A: Hindi-to-English warm chat with memory.
- Server B: Memory, contradiction, and re-verification.
- Both use streaming STT and expressive TTS.

## Notes

- Twilio connects to `/twiml`, then opens a WebSocket at `/media`.
- Sarvam STT uses `saaras:v3-realtime` with `mode=translate` and `stream_type=fast`.
- Sarvam TTS uses `bulbul:v3` with `output_audio_codec=mulaw` so the audio can be sent straight back to Twilio.
