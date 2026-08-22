import { startVoiceServer } from './voice-runtime.js';

startVoiceServer({
  name: 'Call 2',
  port: Number(process.env.PORT || process.env.PORT_B || 3002),
  mediaPath: '/media',
  sttLanguageCode: 'auto',
  sttMode: 'translate',
  streamType: 'fast',
  initialResponses: () => ([{
    text: 'Hey... how’s your cough now? You had a little cough yesterday... is it better?',
    languageCode: 'en-IN',
    speaker: 'simran',
    pace: 0.88,
    temperature: 0.68
  }]),
  createMemory: () => ({
    coughDisputed: false,
    interviewAsked: false,
    appleAsked: false
  }),
  matchTranscript: ({ normalized, memory }) => {
    const responses = [];

    if (/\b(cough|coughed|coughing)\b/.test(normalized) && /\b(didn'?t|did not|no|not)\b/.test(normalized)) {
      memory.coughDisputed = true;
      responses.push({
        text: 'Hmm... are you sure? ... I remember hearing you cough yesterday... but I could be mistaken.',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.86,
        temperature: 0.62
      });
      return responses;
    }

    if (memory.coughDisputed && /\b(maybe|perhaps|i guess|could be|might have|okay|oh)\b/.test(normalized)) {
      memory.coughDisputed = false;
      memory.interviewAsked = true;
      responses.push(
        {
          text: 'Yeah... I just wanted to make sure you’re alright.',
          languageCode: 'en-IN',
          speaker: 'simran',
          pace: 0.88,
          temperature: 0.65
        },
        {
          text: 'And your son’s interview... how did it go?',
          languageCode: 'en-IN',
          speaker: 'simran',
          pace: 0.9,
          temperature: 0.7
        }
      );
      return responses;
    }

    if (/\binterview\b/.test(normalized) && /\b(went really well|really well|well|good|great|excellent)\b/.test(normalized)) {
      responses.push({
        text: 'Ah, that’s wonderful! ... I’m really happy to hear that!',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.92,
        temperature: 0.75
      });
      return responses;
    }

    if (/\bapple\b/.test(normalized) && /\b(didn'?t|did not|no|not)\b/.test(normalized)) {
      memory.appleAsked = true;
      responses.push({
        text: 'Oh...? ... How come you didn’t have one today? Is everything alright?',
        languageCode: 'en-IN',
        speaker: 'simran',
        pace: 0.84,
        temperature: 0.62
      });
      return responses;
    }

    return responses;
  }
});
