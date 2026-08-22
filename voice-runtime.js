import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import twilio from 'twilio';

const { twiml } = twilio;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toWsUrl(baseUrl, path) {
  const wsBase = baseUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  return new URL(path, wsBase).toString();
}

function formatNumberWord(value) {
  const words = {
    0: 'Zero',
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
    6: 'Six',
    7: 'Seven',
    8: 'Eight',
    9: 'Nine',
    10: 'Ten',
    11: 'Eleven',
    12: 'Twelve'
  };

  return words[value] || String(value);
}

function chunkBuffer(buffer, size = 160) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }
  return chunks;
}

function toBase64Audio(response) {
  const audio = response?.audios?.[0];
  if (!audio) {
    throw new Error('Sarvam TTS response did not include audio.');
  }

  return Buffer.from(audio, 'base64');
}

function buildTextToSpeechRequestBody(response) {
  return {
    text: response.text,
    language_code: response.languageCode,
    speaker: response.speaker,
    pace: response.pace,
    temperature: response.temperature,
    model: 'bulbul:v3',
    output_audio_codec: 'mulaw',
    speech_sample_rate: 8000
  };
}

async function synthesizeSpeech(response) {
  const apiKey = requireEnv('SARVAM_API_KEY');

  const result = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': apiKey
    },
    body: JSON.stringify(buildTextToSpeechRequestBody(response))
  });

  if (!result.ok) {
    throw new Error(`Sarvam TTS failed: ${result.status}`);
  }

  return toBase64Audio(await result.json());
}

function connectToSarvamStt(session, profile, onFinalTranscript, onPartialTranscript) {
  const apiKey = requireEnv('SARVAM_API_KEY');
  const url = new URL('https://api.sarvam.ai/speech-to-text-realtime/ws');
  url.searchParams.set('language_code', profile.sttLanguageCode || 'auto');
  url.searchParams.set('model', 'saaras:v3-realtime');
  url.searchParams.set('stream_type', profile.streamType || 'fast');
  url.searchParams.set('mode', profile.sttMode || 'translate');
  url.searchParams.set('endpointing', 'vad');
  url.searchParams.set('encoding', 'mulaw');
  url.searchParams.set('sample_rate', '8000');
  url.searchParams.set('threshold', String(profile.threshold ?? 0.3));
  url.searchParams.set('silence_duration_ms', String(profile.silenceDurationMs ?? 400));
  url.searchParams.set('min_speech_duration_ms', String(profile.minSpeechDurationMs ?? 120));

  const stt = new WebSocket(url, {
    headers: {
      'api-subscription-key': apiKey
    }
  });

  stt.on('open', () => {
    session.sttReady = true;
  });

  stt.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.event === 'transcript.partial') {
      if (typeof onPartialTranscript === 'function') {
        onPartialTranscript(message.text || '');
      }
      return;
    }

    if (message.event === 'transcript.final') {
      onFinalTranscript(message.text || '');
    }
  });

  stt.on('close', () => {
    session.sttReady = false;
  });

  stt.on('error', (error) => {
    console.error(`[${profile.name}] Sarvam STT error:`, error.message);
  });

  return stt;
}

function createSpeechSession(ws, profile, streamSid) {
  const session = {
    streamSid,
    sttReady: false,
    currentSpeechToken: 0,
    playbackQueue: Promise.resolve(),
    memory: profile.createMemory ? profile.createMemory() : {}
  };

  const sendMediaChunk = (chunk) => {
    if (ws.readyState !== WebSocket.OPEN || !session.streamSid) {
      return;
    }

    ws.send(JSON.stringify({
      event: 'media',
      streamSid: session.streamSid,
      media: { payload: chunk.toString('base64') }
    }));
  };

  const stopSpeech = () => {
    session.currentSpeechToken += 1;
  };

  const speak = async (response, token) => {
    const audio = await synthesizeSpeech(response);
    if (token !== session.currentSpeechToken) {
      return;
    }

    for (const chunk of chunkBuffer(audio, 160)) {
      if (token !== session.currentSpeechToken) {
        return;
      }

      sendMediaChunk(chunk);
      await delay(20);
    }
  };

  const enqueueResponses = (responses) => {
    if (!responses || responses.length === 0) {
      return;
    }

    session.currentSpeechToken += 1;
    const token = session.currentSpeechToken;

    session.playbackQueue = session.playbackQueue
      .then(async () => {
        for (const response of responses) {
          if (token !== session.currentSpeechToken) {
            return;
          }

          await speak(response, token);
        }
      })
      .catch((error) => {
        console.error(`[${profile.name}] Speech playback failed:`, error.message);
      });

    return session.playbackQueue;
  };

  const handleTranscript = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    const responses = profile.matchTranscript({
      text,
      normalized,
      memory: session.memory,
      stopSpeech,
      formatNumberWord
    });

    if (responses && responses.length > 0) {
      enqueueResponses(responses);
    }
  };

  const stt = connectToSarvamStt(session, profile, handleTranscript, () => {
    if (session.currentSpeechToken > 0) {
      stopSpeech();
    }
  });

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (message.event) {
      case 'start':
        session.streamSid = message.start?.streamSid || session.streamSid;
        enqueueResponses(profile.initialResponses({ memory: session.memory, formatNumberWord }));
        break;
      case 'media':
        if (message.media?.payload && stt.readyState === WebSocket.OPEN) {
          stt.send(JSON.stringify({
            event: 'audio_input',
            audio: message.media.payload
          }));
        }
        break;
      case 'stop':
        stopSpeech();
        stt.close();
        ws.close();
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    stopSpeech();
    stt.close();
  });

  ws.on('error', (error) => {
    console.error(`[${profile.name}] Twilio websocket error:`, error.message);
  });
}

export function startVoiceServer(profile) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: profile.mediaPath || '/media' });

  app.post('/call', async (req, res) => {
    try {
      const to = req.body.to;
      if (!to) {
        return res.status(400).json({ error: 'Missing "to" number' });
      }

      const from = requireEnv('TWILIO_PHONE_NUMBER');
      const publicUrl = requireEnv('PUBLIC_BASE_URL');

      const call = await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).calls.create({
        to,
        from,
        url: new URL('/twiml', publicUrl).toString(),
        method: 'POST'
      });

      res.json({ callSid: call.sid, status: call.status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/twiml', (_req, res) => {
    const publicUrl = requireEnv('PUBLIC_BASE_URL');
    const wsUrl = toWsUrl(publicUrl, profile.mediaPath || '/media');
    const response = new twiml.VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: wsUrl });
    res.type('text/xml').send(response.toString());
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: profile.name });
  });

  wss.on('connection', (ws) => {
    createSpeechSession(ws, profile);
  });

  server.listen(profile.port, () => {
    console.log(`${profile.name} listening on http://localhost:${profile.port}`);
    console.log(`Twilio will connect to ${toWsUrl(requireEnv('PUBLIC_BASE_URL'), profile.mediaPath || '/media')}`);
  });
}
