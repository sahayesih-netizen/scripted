import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import twilio from 'twilio';

const { twiml } = twilio;

function now() {
  return new Date().toISOString();
}

function log(scope, message, meta) {
  if (meta === undefined) {
    console.log(`[${now()}] [${scope}] ${message}`);
    return;
  }

  console.log(`[${now()}] [${scope}] ${message}`, meta);
}

function errorLog(scope, message, error) {
  console.error(`[${now()}] [${scope}] ${message}`, error);
}

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

function safePreview(text, limit = 140) {
  if (!text) {
    return '';
  }

  return text.length > limit ? `${text.slice(0, limit)}...` : text;
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

function extractWavPayload(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return buffer;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;

    if (chunkId === 'data') {
      return buffer.subarray(chunkDataStart, chunkDataEnd);
    }

    offset = chunkDataEnd + (chunkSize % 2);
  }

  return buffer;
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

  log('tts', 'requesting speech', {
    languageCode: response.languageCode,
    speaker: response.speaker,
    pace: response.pace,
    temperature: response.temperature,
    text: safePreview(response.text)
  });

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

  const json = await result.json();
  const wav = toBase64Audio(json);
  const payload = extractWavPayload(wav);
  log('tts', 'speech generated', {
    audioCount: json?.audios?.length || 0,
    wavBytes: wav.length,
    payloadBytes: payload.length,
    strippedWavHeader: payload.length !== wav.length
  });
  return payload;
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

  log(session.scope, 'connecting to Sarvam STT', {
    url: url.toString(),
    mode: profile.sttMode || 'translate',
    streamType: profile.streamType || 'fast'
  });

  const stt = new WebSocket(url, {
    headers: {
      'api-subscription-key': apiKey
    }
  });

  stt.on('open', () => {
    session.sttReady = true;
    log(session.scope, 'Sarvam STT socket open');
  });

  stt.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.event === 'session.begin') {
      log(session.scope, 'Sarvam STT session began', message);
      return;
    }

    if (message.event === 'vad.speech_start' || message.event === 'vad.speech_end') {
      log(session.scope, `Sarvam STT ${message.event}`);
      return;
    }

    if (message.event === 'transcript.partial') {
      log(session.scope, 'Sarvam partial transcript', { text: safePreview(message.text || '') });
      if (typeof onPartialTranscript === 'function') {
        onPartialTranscript(message.text || '');
      }
      return;
    }

    if (message.event === 'transcript.final') {
      log(session.scope, 'Sarvam final transcript', { text: safePreview(message.text || '') });
      onFinalTranscript(message.text || '');
      return;
    }

    if (message.event === 'error') {
      errorLog(session.scope, 'Sarvam STT error event', message);
    }
  });

  stt.on('close', () => {
    session.sttReady = false;
    log(session.scope, 'Sarvam STT socket closed');
  });

  stt.on('error', (error) => {
    errorLog(session.scope, 'Sarvam STT socket error', error.message);
  });

  return stt;
}

function createSpeechSession(ws, profile, streamSid) {
  const sessionId = crypto.randomUUID().slice(0, 8);
  const session = {
    scope: `${profile.name}:${sessionId}`,
    streamSid,
    sttReady: false,
    currentSpeechToken: 0,
    allowBargeIn: false,
    playbackQueue: Promise.resolve(),
    memory: profile.createMemory ? profile.createMemory() : {}
  };

  log(session.scope, 'session created', { initialStreamSid: streamSid || null });

  const sendMediaChunk = (chunk) => {
    if (ws.readyState !== WebSocket.OPEN || !session.streamSid) {
      log(session.scope, 'skipping outbound audio chunk', {
        wsReadyState: ws.readyState,
        streamSid: session.streamSid || null
      });
      return;
    }

    ws.send(JSON.stringify({
      event: 'media',
      streamSid: session.streamSid,
      media: { payload: chunk.toString('base64') }
    }));
    log(session.scope, 'sent outbound audio chunk', { bytes: chunk.length });
  };

  const stopSpeech = () => {
    session.currentSpeechToken += 1;
    log(session.scope, 'speech token advanced', { token: session.currentSpeechToken });
  };

  const speak = async (response, token) => {
    log(session.scope, 'speaking response', { text: safePreview(response.text) });
    const audio = await synthesizeSpeech(response);
    if (token !== session.currentSpeechToken) {
      log(session.scope, 'speech cancelled before playback');
      return;
    }

    let loggedFirstChunk = false;
    for (const chunk of chunkBuffer(audio, 160)) {
      if (token !== session.currentSpeechToken) {
        log(session.scope, 'speech cancelled mid playback');
        return;
      }

      sendMediaChunk(chunk);
      if (!loggedFirstChunk) {
        log(session.scope, 'first outbound audio chunk sent', { bytes: chunk.length });
        loggedFirstChunk = true;
      }
      await delay(20);
    }
  };

  const enqueueResponses = (responses, options = {}) => {
    if (!responses || responses.length === 0) {
      log(session.scope, 'no responses queued');
      return;
    }

    session.currentSpeechToken += 1;
    const token = session.currentSpeechToken;
    const initial = Boolean(options.initial);
    if (initial) {
      session.allowBargeIn = false;
    }

    log(session.scope, 'queueing responses', { count: responses.length, token, initial });

    session.playbackQueue = session.playbackQueue
      .then(async () => {
        for (const response of responses) {
          if (token !== session.currentSpeechToken) {
            log(session.scope, 'response queue cancelled before next item');
            return;
          }

          await speak(response, token);
        }

        if (initial) {
          session.allowBargeIn = true;
          log(session.scope, 'initial prompt complete, barge-in enabled');
        }
      })
      .catch((error) => {
        errorLog(session.scope, 'Speech playback failed', error.message);
      });

    return session.playbackQueue;
  };

  const handleTranscript = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) {
      log(session.scope, 'ignored empty transcript');
      return;
    }

    log(session.scope, 'handling transcript', { text: safePreview(text), normalized: safePreview(normalized) });

    const responses = profile.matchTranscript({
      text,
      normalized,
      memory: session.memory,
      stopSpeech,
      formatNumberWord
    });

    if (responses && responses.length > 0) {
      log(session.scope, 'matched response(s)', { count: responses.length });
      enqueueResponses(responses);
    } else {
      log(session.scope, 'no scripted match for transcript');
    }
  };

  const stt = connectToSarvamStt(session, profile, handleTranscript, () => {
    if (session.allowBargeIn && session.currentSpeechToken > 0) {
      log(session.scope, 'barge-in detected, stopping speech');
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
        log(session.scope, 'Twilio stream started', {
          callSid: message.start?.callSid || null,
          streamSid: session.streamSid || null,
          customParameters: message.start?.customParameters || null
        });
        enqueueResponses(profile.initialResponses({ memory: session.memory, formatNumberWord }), { initial: true });
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
        log(session.scope, 'Twilio stream stopped');
        stopSpeech();
        stt.close();
        ws.close();
        break;
      default:
        log(session.scope, 'received Twilio websocket event', {
          event: message.event,
          streamSid: message.streamSid || message.start?.streamSid || null
        });
        break;
    }
  });

  ws.on('close', () => {
    log(session.scope, 'Twilio websocket closed');
    stopSpeech();
    stt.close();
  });

  ws.on('error', (error) => {
    errorLog(session.scope, 'Twilio websocket error', error.message);
  });
}

export function startVoiceServer(profile) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: profile.mediaPath || '/media' });

  log(profile.name, 'server booting', {
    port: profile.port,
    mediaPath: profile.mediaPath || '/media',
    sttLanguageCode: profile.sttLanguageCode || 'auto',
    sttMode: profile.sttMode || 'translate'
  });

  app.post('/call', async (req, res) => {
    try {
      const to = req.body.to;
      log(profile.name, '/call request received', { to: to || null });
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

      log(profile.name, 'outbound call created', { callSid: call.sid, status: call.status, to, from });

      res.json({ callSid: call.sid, status: call.status });
    } catch (error) {
      errorLog(profile.name, '/call failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/twiml', (req, res) => {
    const publicUrl = requireEnv('PUBLIC_BASE_URL');
    const wsUrl = toWsUrl(publicUrl, profile.mediaPath || '/media');
    log(profile.name, '/twiml requested', {
      from: req.body.From || null,
      to: req.body.To || null,
      callSid: req.body.CallSid || null,
      wsUrl
    });
    const response = new twiml.VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: wsUrl });
    res.type('text/xml').send(response.toString());
  });

  app.get('/health', (_req, res) => {
    log(profile.name, '/health requested');
    res.json({ ok: true, name: profile.name });
  });

  wss.on('connection', (ws) => {
    log(profile.name, 'Twilio websocket connected');
    createSpeechSession(ws, profile);
  });

  wss.on('error', (error) => {
    errorLog(profile.name, 'WebSocket server error', error);
  });

  server.listen(profile.port, () => {
    log(profile.name, 'listening', { url: `http://localhost:${profile.port}` });
    log(profile.name, 'expected Twilio media url', { url: toWsUrl(requireEnv('PUBLIC_BASE_URL'), profile.mediaPath || '/media') });
  });
}
