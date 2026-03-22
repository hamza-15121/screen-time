const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const textToSpeech = require("@google-cloud/text-to-speech");
const { parseSequenceMarkdown, sequenceToNarration } = require("../lib/sequenceParser");

function parseArgs(argv) {
  const out = {
    provider: process.env.TTS_PROVIDER || "openai",
    input: path.resolve(process.cwd(), "passcode_sequences_50.md"),
    outputDir: path.resolve(process.cwd(), "tts-output"),
    openaiModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    openaiVoice: process.env.OPENAI_TTS_VOICE || "alloy",
    googleVoice: process.env.GOOGLE_TTS_VOICE || "en-US-Neural2-D",
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--provider") out.provider = argv[++i];
    else if (a === "--input") out.input = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--output") out.outputDir = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--openai-model") out.openaiModel = argv[++i];
    else if (a === "--openai-voice") out.openaiVoice = argv[++i];
    else if (a === "--google-voice") out.googleVoice = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

async function synthesizeOpenAI(client, text, cfg) {
  const response = await client.audio.speech.create({
    model: cfg.openaiModel,
    voice: cfg.openaiVoice,
    input: text,
    format: "mp3"
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function synthesizeGoogle(client, text, cfg) {
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: "en-US",
      name: cfg.googleVoice
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.93
    }
  });
  return response.audioContent;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const sequences = parseSequenceMarkdown(cfg.input);
  if (!sequences.length) throw new Error(`No passcode sequences found in ${cfg.input}`);

  fs.mkdirSync(cfg.outputDir, { recursive: true });

  let openai;
  let google;
  if (!cfg.dryRun && cfg.provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for OpenAI provider.");
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  if (!cfg.dryRun && cfg.provider === "google") {
    google = new textToSpeech.TextToSpeechClient();
  }

  const manifest = [];

  for (let i = 0; i < sequences.length; i += 1) {
    const item = sequences[i];
    const index = String(i + 1).padStart(2, "0");

    const variants = [
      { kind: "entry", sequence: item.entry },
      { kind: "confirm", sequence: item.confirm }
    ];

    for (const variant of variants) {
      const narration = sequenceToNarration(variant.sequence, variant.kind === "entry" ? "Entry" : "Confirm");
      const fileName = `${index}_${item.passcode}_${variant.kind}.mp3`;
      const filePath = path.join(cfg.outputDir, fileName);

      if (!cfg.dryRun) {
        const audioBuffer = cfg.provider === "google"
          ? await synthesizeGoogle(google, narration, cfg)
          : await synthesizeOpenAI(openai, narration, cfg);
        fs.writeFileSync(filePath, audioBuffer);
      }

      manifest.push({
        index: i + 1,
        passcode: item.passcode,
        kind: variant.kind,
        file: fileName,
        tokenCount: variant.sequence.length,
        narration
      });

      process.stdout.write(`Generated ${fileName}${cfg.dryRun ? " (dry-run)" : ""}\n`);
    }
  }

  fs.writeFileSync(path.join(cfg.outputDir, "manifest.json"), JSON.stringify({ provider: cfg.provider, count: manifest.length, items: manifest }, null, 2));
  process.stdout.write(`Done. ${manifest.length} audio items prepared in ${cfg.outputDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
