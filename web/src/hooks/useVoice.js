/**
 * Voice input (STT) and output (TTS).
 * Premium: OpenAI Whisper + TTS (ChatGPT-level) when OPENAI_API_KEY is set.
 * Fallback: Web Speech API (Chrome/Edge for STT, all browsers for TTS).
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../api';

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const SpeechSynthesis = typeof window !== 'undefined' && window.speechSynthesis;

const LANG_MAP = { fr: 'fr-FR', en: 'en-US' };
const DEFAULT_LANG = (typeof navigator !== 'undefined' && navigator.language?.startsWith('fr')) ? 'fr' : 'en';

function detectLangFromText(text) {
  if (!text || typeof text !== 'string') return 'en';
  const t = text.slice(0, 500);
  const frMarks = (t.match(/[éèêëàâùûîïçô]/gi) || []).length;
  const frWords = /\b(est|les|des|une|dans|pour|avec|sont|qui|que|pas|mais|comme|tout|bien|plus|fait)\b/gi;
  const frScore = frMarks + (t.match(frWords) || []).length;
  return frScore >= 2 ? 'fr' : 'en';
}

export function useVoiceInput(lang = DEFAULT_LANG) {
  const langCode = LANG_MAP[lang] || LANG_MAP.en;
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const [premiumStt, setPremiumStt] = useState(false);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const finalRef = useRef('');

  useEffect(() => {
    api.voiceStatus().then((r) => setPremiumStt(r.stt === true)).catch(() => setPremiumStt(false));
  }, []);

  const useWhisper = premiumStt;

  const startListeningWeb = useCallback(() => {
    if (!SpeechRecognition) {
      setError(lang === 'fr' ? 'Reconnaissance vocale non supportée (Chrome/Edge uniquement)' : 'Voice input not supported (Chrome/Edge only)');
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError(lang === 'fr' ? 'Micro requis : page en HTTPS ou localhost' : 'Micro required: HTTPS or localhost');
      return;
    }
    setError(null);
    setInterimTranscript('');
    finalRef.current = '';
    recognitionRef.current = null;
    let silenceTimer = null;
    const FLUSH_SILENCE_MS = 1500;
    const MIN_WORDS = 3;
    const MIN_LENGTH = 12;

    const flushVoice = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      const msg = (finalRef.current || '').trim().replace(/\s+/g, ' ');
      if (!msg) return;
      const words = msg.split(/\s+/).filter(Boolean).length;
      if (words < MIN_WORDS || msg.length < MIN_LENGTH) {
        finalRef.current = '';
        return;
      }
      finalRef.current = '';
      const rec = recognitionRef.current;
      if (rec?._onStopped) rec._onStopped(msg);
      if (rec) rec._onStopped = null;
    };

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langCode;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          finalRef.current = (finalRef.current || '') + t + ' ';
        } else {
          interim += t;
        }
      }
      setInterimTranscript(((finalRef.current || '') + interim).trim());
      silenceTimer = setTimeout(flushVoice, FLUSH_SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') setError(lang === 'fr' ? 'Micro bloqué. Autorisez le micro.' : 'Micro blocked.');
      else if (e.error === 'no-speech') setError(lang === 'fr' ? 'Aucun son détecté. Parlez plus fort.' : 'No sound detected.');
      else if (e.error !== 'aborted') setError(`Erreur: ${e.error}`);
    };
    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      const t = (finalRef.current || '').trim().replace(/\s+/g, ' ');
      finalRef.current = '';
      if (t) {
        const words = t.split(/\s+/).filter(Boolean).length;
        if (words >= MIN_WORDS && t.length >= MIN_LENGTH && rec._onStopped) {
          rec._onStopped(t);
        }
      }
      rec._onStopped = null;
      recognitionRef.current = null;
      setInterimTranscript('');
      setIsListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch (err) {
      setError(err.message || 'Mic error');
      setIsListening(false);
    }
  }, [lang, langCode]);

  const startListeningPremium = useCallback(async () => {
    setError(null);
    setInterimTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mediaRecorderRef.current = mr;
      mr.start(100);
      setIsListening(true);
    } catch (err) {
      setError(lang === 'fr' ? 'Micro inaccessible. Autorisez le micro.' : 'Micro inaccessible. Allow microphone.');
    }
  }, [lang]);

  const startListening = useCallback(() => {
    if (useWhisper) startListeningPremium();
    else if (SpeechRecognition) startListeningWeb();
    else setError(lang === 'fr' ? 'Voix non disponible. Chrome/Edge ou configurer OPENAI_API_KEY.' : 'Voice not available. Use Chrome/Edge or set OPENAI_API_KEY.');
  }, [useWhisper, startListeningPremium, startListeningWeb, lang]);

  const stopListening = useCallback((onStopped) => {
    if (useWhisper && mediaRecorderRef.current?.state !== 'inactive') {
      const mr = mediaRecorderRef.current;
      const stream = streamRef.current;
      mediaRecorderRef.current = null;
      streamRef.current = null;

      mr.onstop = async () => {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
        setIsTranscribing(true);
        setError(null);
        const chunks = chunksRef.current;
        const mimeType = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 500) {
          setIsTranscribing(false);
          setError(lang === 'fr' ? 'Parlez plus longtemps (au moins 1 seconde)' : 'Speak longer (at least 1 second)');
          if (onStopped) onStopped('');
          return;
        }
        try {
          const { text } = await api.voiceStt(blob);
          if (onStopped) onStopped(text || '');
        } catch (e) {
          const msg = e.body?.error || e.message || (lang === 'fr' ? 'Erreur transcription' : 'Transcription error');
          setError(msg);
          if (onStopped) onStopped('');
        } finally {
          setIsTranscribing(false);
        }
      };
      mr.stop();
    } else if (recognitionRef.current) {
      recognitionRef.current._onStopped = (t) => {
        setIsListening(false);
        if (onStopped) onStopped(t || '');
      };
      recognitionRef.current.stop();
    } else if (onStopped) onStopped('');
  }, [useWhisper, lang]);

  const supported = premiumStt || !!SpeechRecognition;

  const getTranscript = useCallback(() => {
    const t = (recognitionRef.current?._lastTranscript || finalRef.current || interimTranscript).trim();
    finalRef.current = '';
    setInterimTranscript('');
    if (recognitionRef.current) recognitionRef.current._lastTranscript = '';
    return t;
  }, [interimTranscript]);

  const testMicAccess = useCallback(async () => {
    setError(null);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        return true;
      }
      return false;
    } catch (err) {
      setError(lang === 'fr' ? 'Micro inaccessible.' : 'Micro inaccessible.');
      return false;
    }
  }, [lang]);

  const recordingMode = useWhisper;
  return { isListening, isTranscribing, interimTranscript, error, startListening, stopListening, getTranscript, testMicAccess, supported, premium: premiumStt, recordingMode };
}

export function useVoiceOutput(lang = DEFAULT_LANG) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [premiumTts, setPremiumTts] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    api.voiceStatus().then((r) => setPremiumTts(r.tts === true)).catch(() => setPremiumTts(false));
  }, []);

  useEffect(() => {
    if (!SpeechSynthesis) return;
    return () => { SpeechSynthesis.cancel(); };
  }, []);

  const speakPremium = useCallback(async (text, onComplete) => {
    const t = (text || '').trim();
    if (!t) {
      onComplete?.();
      return;
    }
    try {
      const blob = await api.voiceTts(t);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
        onComplete?.();
      };
      audio.play();
    } catch (e) {
      setIsSpeaking(false);
      console.error('[EVA Voice] TTS:', e);
      onComplete?.();
    }
  }, []);

  const speakWeb = useCallback((text, onComplete) => {
    if (!SpeechSynthesis || !text?.trim()) {
      onComplete?.();
      return;
    }
    SpeechSynthesis.cancel();
    const effectiveLang = detectLangFromText(text) || lang;
    const langCode = LANG_MAP[effectiveLang] || LANG_MAP.en;
    const u = new SpeechSynthesisUtterance(text.trim());
    u.lang = langCode;
    u.rate = 1;
    u.pitch = 1;
    const voices = SpeechSynthesis.getVoices();
    const preferred = voices.find((v) => v.lang.startsWith(langCode.slice(0, 2))) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
    if (preferred) u.voice = preferred;
    u.onstart = () => setIsSpeaking(true);
    u.onend = u.onerror = () => { setIsSpeaking(false); onComplete?.(); };
    SpeechSynthesis.speak(u);
  }, [lang]);

  const speak = useCallback((text, onComplete) => {
    if (premiumTts) speakPremium(text, onComplete);
    else speakWeb(text, onComplete);
  }, [premiumTts, speakPremium, speakWeb]);

  const stop = useCallback(() => {
    if (premiumTts && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (SpeechSynthesis) SpeechSynthesis.cancel();
    setIsSpeaking(false);
  }, [premiumTts]);

  const supported = premiumTts || !!SpeechSynthesis;
  return { speak, stop, isSpeaking, supported, premium: premiumTts };
}
