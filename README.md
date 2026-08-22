# Voice Call Bot

This is a minimal outbound call bot:

1. Your server places a phone call.
2. Twilio captures the callee's speech.
3. The server picks a canned reply.
4. Sarvam generates the audio.
5. Twilio plays that audio back on the call.

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
- `SARVAM_TTS_URL`
- `SARVAM_API_KEY` if needed by your Sarvam endpoint
- `SARVAM_VOICE` if your API expects one
- `SARVAM_FORMAT` if your API expects one

`PUBLIC_BASE_URL` must be a public URL such as an ngrok tunnel.

You can copy `.env.example` to `.env` and fill in the values.

## Run

```bash
npm start
```

## Start a call

Send a POST request to `/call`:

```bash
curl -X POST http://localhost:3000/call -H "Content-Type: application/json" -d "{\"to\":\"+1234567890\"}"
```

## Voice flow

- First prompt: "Hello. Please say yes or no."
- If the user says yes or sure: "Thanks. Please tell me your account number."
- If the user says no or stop: "Understood. I will end the call now."
- Otherwise: "I did not catch that. Please say yes or no."

## Notes

- The Sarvam endpoint format may differ from the placeholder in `server.js`.
- The server caches generated audio in memory and serves it back to Twilio.
- If you want, I can make the reply logic multi-step or connect it to your exact script next.
