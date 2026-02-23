# Connect iPhone to EVA (local network)

## Steps

1. **Mac and iPhone on same WiFi**

2. **Get your Mac's IP**:
   ```bash
   ipconfig getifaddr en0
   ```
   Example: `192.168.1.50`

3. **Start EVA**: `cd eva && npm run dev`

4. **On iPhone Safari**, open:
   - **Chat (text)**: `http://YOUR_MAC_IP:5002` or `http://YOUR_MAC_IP:3001`
   - Both work; 5002 serves built app, 3001 is Vite dev.

## Voice / microphone on iPhone

**Important**: iOS Safari requires **HTTPS** for microphone access (except localhost).  
Over `http://` from iPhone, voice input (Real Time, Whisper STT) will **not work**.

**Options for voice on iPhone**:
- Use **eva.halisoft.biz** (production, HTTPS) if deployed
- Use **ngrok**: `ngrok http 5002` → use the HTTPS URL on iPhone
- Use **macOS** for voice testing (Chrome/Safari on Mac allow localhost)
