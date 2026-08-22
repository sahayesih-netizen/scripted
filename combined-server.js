import { startMultiVoiceServer } from './voice-runtime.js';
import { profilesByKey } from './voice-profiles.js';

startMultiVoiceServer(profilesByKey);
