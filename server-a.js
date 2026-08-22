import { startVoiceServer } from './voice-runtime.js';

startVoiceServer({
  name: 'Call 1',
  port: Number(process.env.PORT || process.env.PORT_A || 3001),
  mediaPath: '/media',
  sttLanguageCode: 'auto',
  sttMode: 'translate',
  streamType: 'fast',
  initialResponses: () => ([{
    text: 'नमस्ते जी! मैं साथी — ना कोई जल्दी, ना कोई काम, बस आपके साथ थोड़ी मीठी बातें और आराम! कैसे हैं आप आज?',
    languageCode: 'hi-IN',
    speaker: 'simran',
    pace: 0.92,
    temperature: 0.72
  }]),
  createMemory: () => ({
    translationHandled: false,
    wakeTime: null,
    sonInterview: null,
    cough: false,
    appleHabit: false,
    bedLate: false
  }),
  matchTranscript: ({ normalized, memory, formatNumberWord }) => {
    const responses = [];

    if (!memory.translationHandled && /\b(convert|translate)\b.*\benglish\b|\benglish\b.*\b(convert|translate)\b/.test(normalized)) {
      memory.translationHandled = true;
      responses.push({
        text: 'Namaste! I’m Saathi — no rush, no work, just some sweet little conversations and a little time to relax with you. How are you today?',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.97,
        temperature: 0.74
      });
      return responses;
    }

    if (/\b(woke up|wake up|got up)\b/.test(normalized) || (/\b(today|this morning)\b/.test(normalized) && /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/.test(normalized))) {
      const match = normalized.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
      const valueMap = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12
      };
      const raw = match?.[1];
      const number = raw ? (Number.isNaN(Number(raw)) ? valueMap[raw] : Number(raw)) : 12;
      memory.wakeTime = number;
      responses.push({
        text: `${formatNumberWord(number)}...? You usually wake up around nine... was your bed just a little too comfortable today?`,
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.9,
        temperature: 0.68
      });
      return responses;
    }

    if (/\bson\b/.test(normalized) && /\binterview\b/.test(normalized)) {
      memory.sonInterview = normalized;
      responses.push({
        text: 'Oh, really...? That’s wonderful! I’m sure he’s going to do really well... please wish him all the best from me, okay?',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.92,
        temperature: 0.75
      });
      return responses;
    }

    if (/\b(cough|coughed|coughing)\b/.test(normalized)) {
      memory.cough = true;
      responses.push({
        text: 'Oh... you just coughed. Are you alright? ... Have a little sip of water... slowly, okay?',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.84,
        temperature: 0.64
      });
      return responses;
    }

    if (/\bapple\b/.test(normalized)) {
      memory.appleHabit = true;
      responses.push({
        text: 'Oh... every day? That’s a really good habit... keep it going, okay?',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.92,
        temperature: 0.7
      });
      return responses;
    }

    if (/\bbed\b/.test(normalized) && /\blate\b/.test(normalized)) {
      memory.bedLate = true;
    }

    return responses;
  }
});
