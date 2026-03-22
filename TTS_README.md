# Scrrentime TTS Generation

This project includes a generator that converts `passcode_sequences_50.md` into spoken audio files.

## Providers

- OpenAI TTS
- Google Cloud Text-to-Speech

## 1) OpenAI setup

Set your key in PowerShell:

```powershell
$env:OPENAI_API_KEY="<your_key>"
```

Generate MP3 files:

```powershell
node src/tools/generate-tts.js --provider openai --input passcode_sequences_50.md --output tts-output
```

Optional voice/model:

```powershell
node src/tools/generate-tts.js --provider openai --openai-model gpt-4o-mini-tts --openai-voice alloy
```

## 2) Google setup

Set credentials:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\service-account.json"
```

Generate MP3 files:

```powershell
node src/tools/generate-tts.js --provider google --input passcode_sequences_50.md --output tts-output
```

Optional voice:

```powershell
node src/tools/generate-tts.js --provider google --google-voice en-US-Neural2-D
```

## Output

- `tts-output/*.mp3` (100 files: entry + confirm for each passcode)
- `tts-output/manifest.json`

Each audio starts with: "Please press the following keys." and then narrates each key step with pacing.
