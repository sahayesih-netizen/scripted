import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import twilio from 'twilio';

const { twiml } = twilio;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const port = Number(process.env.PORT || 3000);
function getBaseUrl() {
  return requireEnv('PUBLIC_BASE_URL');
}

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const audioCache = new Map();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function chooseReply(text = '') {
  const input = text.toLowerCase();

  if (input.includes('yes') || input.includes('sure') || input.includes('okay')) {
    return 'Thanks. Please tell me your account number.';
  }

  if (input.includes('no') || input.includes('stop') || input.includes('cancel')) {
    return 'Understood. I will end the call now.';
  }

  if (input.includes('account')) {
    return 'Got it. I have noted that down.';
  }

  return 'I did not catch that. Please say yes or no.';
}

async function fetchSarvamAudioBuffer(text) {
  const sarvamUrl = process.env.SARVAM_TTS_URL;
  if (!sarvamUrl) {
    throw new Error('Missing required env var: SARVAM_TTS_URL');
  }

  const response = await fetch(sarvamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SARVAM_API_KEY ? { Authorization: `Bearer ${process.env.SARVAM_API_KEY}` } : {})
    },
    body: JSON.stringify({
      text,
      voice: process.env.SARVAM_VOICE || 'default',
      format: process.env.SARVAM_FORMAT || 'mp3'
    })
  });

  if (!response.ok) {
    throw new Error(`Sarvam request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.audio_base64 || data.audio) {
    const base64 = data.audio_base64 || data.audio;
    return Buffer.from(base64, 'base64');
  }

  const audioUrl = data.audio_url || data.url;
  if (!audioUrl) {
    throw new Error('Sarvam response did not include audio data or URL.');
  }

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download Sarvam audio: ${audioResponse.status}`);
  }

  return Buffer.from(await audioResponse.arrayBuffer());
}

async function getAudioUrl(text) {
  const buffer = await fetchSarvamAudioBuffer(text);
  const id = crypto.randomUUID();
  audioCache.set(id, buffer);
  return `${getBaseUrl()}/audio/${id}.mp3`;
}

function buildVoiceResponse(audioUrl) {
  const response = new twiml.VoiceResponse();
  const gather = response.gather({
    input: 'speech',
    action: '/voice',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US'
  });

  gather.play(audioUrl);
  response.redirect({ method: 'POST' }, '/voice');
  return response.toString();
}

app.post('/call', async (req, res) => {
  try {
    const to = req.body.to;
    if (!to) {
      return res.status(400).json({ error: 'Missing "to" number' });
    }

    const from = requireEnv('TWILIO_PHONE_NUMBER');
    const voiceUrl = `${getBaseUrl()}/voice`;

    const call = await twilioClient.calls.create({
      to,
      from,
      url: voiceUrl,
      method: 'POST'
    });

    res.json({ callSid: call.sid, status: call.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/voice', async (req, res) => {
  try {
    const userSpeech = req.body.SpeechResult || '';
    const replyText = userSpeech ? chooseReply(userSpeech) : 'Hello. Please say yes or no.';
    const audioUrl = await getAudioUrl(replyText);
    res.type('text/xml').send(buildVoiceResponse(audioUrl));
  } catch (error) {
    const response = new twiml.VoiceResponse();
    response.say(`Sorry, there was an error: ${error.message}`);
    res.type('text/xml').send(response.toString());
  }
});

app.get('/audio/:id.mp3', (req, res) => {
  const buffer = audioCache.get(req.params.id);
  if (!buffer) {
    return res.sendStatus(404);
  }

  res.type('audio/mpeg').send(buffer);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log('Set PUBLIC_BASE_URL to your public tunnel URL so Twilio can reach this server.');
});
