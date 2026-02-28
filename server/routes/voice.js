/**
 * EVA Voice API – OpenAI Whisper (STT) + TTS.
 * ChatGPT-level oral communication when OPENAI_API_KEY is set.
 */
const express = require('express');
const router = express.Router();

function getOpenAIKey() {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return (k && !k.startsWith('sk-your-') && k !== 'sk-xxxxx') ? k : null;
}

// Status: is premium voice (Whisper+TTS) available?
router.get('/status', (req, res) => {
  const enabled = !!getOpenAIKey();
  res.json({ enabled, stt: enabled, tts: enabled });
});

// Speech-to-text (Whisper) — accepts JSON { audio: base64, format, lang }
router.post('/stt', async (req, res, next) => {
  try {
    const OPENAI_KEY = getOpenAIKey();
    if (!OPENAI_KEY) {
      return res.status(503).json({ error: 'Voice API disabled. Set OPENAI_API_KEY.' });
    }

    let buffer;
    const { audio, format = 'webm', lang: langParam = 'fr' } = req.body || {};

    if (audio && typeof audio === 'string') {
      try {
        buffer = Buffer.from(audio, 'base64');
      } catch (_) {
        return res.status(400).json({ error: 'Invalid base64 audio' });
      }
    }

    if (!buffer || buffer.length < 100) {
      return res.status(400).json({ error: 'Audio required: record at least 1 second' });
    }

    const { default: OpenAI, toFile } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_KEY });

    const lang = String(langParam).slice(0, 2);
    const ext = ['webm', 'm4a', 'mp3', 'mp4', 'ogg'].includes(String(format).toLowerCase()) ? format.toLowerCase() : 'webm';
    const file = await toFile(buffer, `audio.${ext}`, { type: `audio/${ext === 'webm' ? 'webm' : ext}` });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'json',
      language: lang || undefined,
    });

    const text = (transcription.text || '').trim();
    res.json({ text });
  } catch (e) {
    console.error('[EVA Voice] STT error:', e.message, e.status, e.response?.data || '');
    if (res.headersSent) return;
    const msg = e.response?.data?.error?.message || e.message || 'STT failed';
    res.status(e.status || e.statusCode || 500).json({ error: msg });
  }
});

function detectLang(text) {
  if (!text || typeof text !== 'string') return 'en';
  const t = text.slice(0, 500);
  const frMarks = (t.match(/[éèêëàâùûîïçô]/gi) || []).length;
  const frWords = /\b(est|les|des|une|dans|pour|avec|sont|qui|que|pas|mais|comme|tout|bien|plus|fait)\b/gi;
  const frScore = frMarks + (t.match(frWords) || []).length;
  return frScore >= 2 ? 'fr' : 'en';
}

// Text-to-speech (OpenAI TTS) — auto-detects lang from text when lang=auto
router.post('/tts', express.json(), async (req, res, next) => {
  try {
    const OPENAI_KEY = getOpenAIKey();
    if (!OPENAI_KEY) {
      return res.status(503).json({ error: 'Voice API disabled. Set OPENAI_API_KEY.' });
    }

    const { text, lang: langParam = 'auto' } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text (string) required' });
    }

    const trimmed = text.trim().slice(0, 4096);
    if (!trimmed) {
      return res.status(400).json({ error: 'text required' });
    }

    const lang = langParam === 'auto' ? detectLang(trimmed) : String(langParam).slice(0, 2);
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: OPENAI_KEY });

    const voice = lang === 'fr' ? 'nova' : 'alloy'; // natural voices
    const resp = await openai.audio.speech.create({
      model: process.env.EVA_TTS_MODEL || 'tts-1',
      voice,
      input: trimmed,
      response_format: 'mp3',
      speed: 1,
    });

    const buffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    console.error('[EVA Voice] TTS error:', e.message);
    next(e);
  }
});

module.exports = router;
