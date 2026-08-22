# Voice Call Bot

This is a minimal outbound call bot with two dialogue variants behind one service:

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

`PUBLIC_BASE_URL` must be a public URL such as an ngrok tunnel or Railway domain.

You can copy `.env.example` to `.env` and fill in the values.

## Run

```bash
npm start
```

For the separate local variants:

```bash
npm run start:a
npm run start:b
```

## Start a call

Send a POST request to `/call` and pass `script=a` or `script=b`:

```bash
curl -X POST http://localhost:3000/call -H "Content-Type: application/json" -d "{\"to\":\"+1234567890\",\"script\":\"a\"}"
```

Use `script=b` for the second flow.

## Voice flow

- Server A: Hindi-to-English warm chat with memory.
- Server B: Memory, contradiction, and re-verification.
- Both use streaming STT and expressive TTS.

## Notes

- Twilio connects to `/twiml/a` or `/twiml/b`, then opens a WebSocket at `/media/a` or `/media/b`.
- Sarvam STT uses `saaras:v3-realtime` with `mode=translate` and `stream_type=fast`.
- Sarvam TTS uses `bulbul:v3` with `output_audio_codec=mulaw` so the audio can be sent straight back to Twilio.
- Railway can run the combined service with `npm start`.
