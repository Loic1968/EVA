/**
 * EVA Voice API – OpenAI Whisper (STT) + TTS.
 * v2: HD model, per-user voice settings, streaming sentence-level TTS.
 */
const express = require('express');
const router = express.Router();

function getOpenAIKey() {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return (k && !k.startsWith('sk-your-') && k !== 'sk-xxxxx') ? k : null;
}

// ── Voice settings (per-user, from DB) ──
const VOICE_DEFAULTS = {
  tts_model: 'tts-1-hd',    // HD for quality (was tts-1)
  tts_voice_fr: 'nova',      // Best French female voice
  tts_voice_en: 'shimmer',   // Warm English female voice
  tts_speed: 1.05,           // Slightly faster = more natural conversational pace
};

const ALLOWED_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const ALLOWED_MODELS = ['tts-1', 'tts-1-hd'];

async function getVoiceSettings(ownerId) {
  const settings = { ...VOICE_DEFAULTS };
  if (!ownerId) return settings;
  try {
    const db = require('../db');
    const row = await db.query(
      'SELECT value FROM eva.settings WHERE owner_id = $1 AND key = $2',
      [ownerId, 'voice_settings']
    );
    if (row.rows[0]?.value) {
      const v = row.rows[0].value;
      if (ALLOWED_MODELS.includes(v.tts_model)) settings.tts_model = v.tts_model;
      if (ALLOWED_VOICES.includes(v.tts_voice_fr)) settings.tts_voice_fr = v.tts_voice_fr;
      if (ALLOWED_VOICES.includes(v.tts_voice_en)) settings.tts_voice_en = v.tts_voice_en;
      if (typeof v.tts_speed === 'number' && v.tts_speed >= 0.5 && v.tts_speed <= 2) settings.tts_speed = v.tts_speed;
    }
  } catch (_) {}
  return settings;
}

// ── Status ──
router.get('/status', (req, res) => {
  const enabled = !!getOpenAIKey();
  res.json({ enabled, stt: enabled, tts: enabled });
});

// ── Get/set voice settings ──
router.get('/settings', async (req, res) => {
  const settings = await getVoiceSettings(req.ownerId);
  res.json({ ...settings, available_voices: ALLOWED_VOICES, available_models: ALLOWED_MODELS });
});

router.post('/settings', async (req, res) => {
  try {
    const db = require('../db');
    const ownerId = req.ownerId;
    if (!ownerId) return res.status(401).json({ error: 'Not authenticated' });
    const { tts_model, tts_voice_fr, tts_voice_en, tts_speed } = req.body || {};
    const value = {};
    if (ALLOWED_MODELS.includes(tts_model)) value.tts_model = tts_model;
    if (ALLOWED_VOICES.includes(tts_voice_fr)) value.tts_voice_fr = tts_voice_fr;
    if (ALLOWED_VOICES.includes(tts_voice_en)) value.tts_voice_en = tts_voice_en;
    if (typeof tts_speed === 'number' && tts_speed >= 0.5 && tts_speed <= 2) value.tts_speed = tts_speed;
    await db.query(
      `INSERT INTO eva.settings (owner_id, key, value) VALUES ($1, 'voice_settings', $2)
       ON CONFLICT (owner_id, key) DO UPDATE SET value = $2, updated_at = now()`,
      [ownerId, JSON.stringify(value)]
    );
    res.json({ ok: true, ...VOICE_DEFAULTS, ...value });
  } catch (e) {
    console.error('[EVA Voice] settings save error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Speech-to-text (Whisper) ──
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

    const MIN_BYTES = 3000;
    if (!buffer || buffer.length < MIN_BYTES) {
      return res.status(400).json({
        error: 'Audio trop court. Parle au moins 1 seconde avant de relâcher.',
        code: 'audio_too_short',
      });
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
    const openaiMsg = e.response?.data?.error?.message || e.response?.data?.message;
    console.error('[EVA Voice] STT error:', e.message, e.status, openaiMsg || e.response?.data || '');
    if (res.headersSent) return;
    const msg = openaiMsg || e.message || 'STT failed';
    const status = e.status || e.statusCode || 500;
    res.status(status).json({ error: msg, code: status === 400 ? 'bad_request' : 'stt_error' });
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

// Split text into sentences for streaming TTS
function splitSentences(text) {
  // Split on sentence boundaries but keep reasonable chunk sizes
  const raw = text.match(/[^.!?…]+[.!?…]+[\s)»"']*/g) || [text];
  const sentences = [];
  let buf = '';
  for (const s of raw) {
    buf += s;
    // Flush when buffer has at least ~40 chars (enough for natural TTS)
    if (buf.trim().length >= 40) {
      sentences.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) {
    // Append short trailing text to last sentence if possible
    if (sentences.length > 0 && buf.trim().length < 30) {
      sentences[sentences.length - 1] += ' ' + buf.trim();
    } else {
      sentences.push(buf.trim());
    }
  }
  return sentences.length ? sentences : [text];
}

// ── TTS (single response — kept for backward compat) ──
router.post('/tts', express.json(), async (req, res, next) => {
  try {
    const OPENAI_KEY = getOpenAIKey();
    if (!OPENAI_KEY) {
      return res.status(503).json({ error: 'Voice API disabled. Set OPENAI_API_KEY.' });
    }

    const { text, lang: langParam = 'auto', voice: voiceParam } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text (string) required' });
    }

    const trimmed = text.trim().slice(0, 4096);
    if (!trimmed) {
      return res.status(400).json({ error: 'text required' });
    }

    const lang = langParam === 'auto' ? detectLang(trimmed) : String(langParam).slice(0, 2);
    const vs = await getVoiceSettings(req.ownerId);

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: OPENAI_KEY });

    const voice = voiceParam && ALLOWED_VOICES.includes(voiceParam)
      ? voiceParam
      : (lang === 'fr' ? vs.tts_voice_fr : vs.tts_voice_en);

    const resp = await openai.audio.speech.create({
      model: vs.tts_model,
      voice,
      input: trimmed,
      response_format: 'mp3',
      speed: vs.tts_speed,
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

// ── Streaming TTS — sentence-by-sentence, multipart binary stream ──
// Returns chunked mp3 parts separated by a length header so frontend can play each ASAP.
// Protocol: for each sentence → [4 bytes: uint32 length][N bytes: mp3 data]
// Final marker: [4 bytes: 0x00000000]
router.post('/tts-stream', express.json(), async (req, res) => {
  const OPENAI_KEY = getOpenAIKey();
  if (!OPENAI_KEY) {
    return res.status(503).json({ error: 'Voice API disabled.' });
  }

  const { text, lang: langParam = 'auto', voice: voiceParam } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }

  const trimmed = text.trim().slice(0, 4096);
  const lang = langParam === 'auto' ? detectLang(trimmed) : String(langParam).slice(0, 2);
  const vs = await getVoiceSettings(req.ownerId);
  const voice = voiceParam && ALLOWED_VOICES.includes(voiceParam)
    ? voiceParam
    : (lang === 'fr' ? vs.tts_voice_fr : vs.tts_voice_en);

  const sentences = splitSentences(trimmed);
  console.log(`[EVA Voice] Streaming TTS: ${sentences.length} chunks, voice=${voice}, model=${vs.tts_model}`);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-TTS-Chunks', String(sentences.length));
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: OPENAI_KEY });

    for (const sentence of sentences) {
      if (res.destroyed || res.writableEnded) break;
      const resp = await openai.audio.speech.create({
        model: vs.tts_model,
        voice,
        input: sentence,
        response_format: 'mp3',
        speed: vs.tts_speed,
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      // Write length header (4 bytes big-endian) + mp3 data
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(buf.length, 0);
      res.write(lenBuf);
      res.write(buf);
    }
    // End marker
    const endBuf = Buffer.alloc(4, 0);
    res.write(endBuf);
    res.end();
  } catch (e) {
    console.error('[EVA Voice] TTS-stream error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.end();
    }
  }
});

module.exports = router;
