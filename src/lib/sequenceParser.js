const fs = require("fs");

function parseSequenceMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  const items = [];
  let current = null;
  let mode = null;

  for (const line of lines) {
    const passcodeMatch = line.match(/^##\s+\d+\.\s+Passcode:\s+(\d{4})\s*$/);
    if (passcodeMatch) {
      if (current) items.push(current);
      current = { passcode: passcodeMatch[1], entry: [], confirm: [] };
      mode = null;
      continue;
    }

    if (!current) continue;

    if (line.trim() === "### Entry Sequence") {
      mode = "entry";
      continue;
    }

    if (line.trim() === "### Confirm Sequence") {
      mode = "confirm";
      continue;
    }

    if (line.trim() === "---") {
      mode = null;
      continue;
    }

    const token = line.trim();
    if (!token) continue;
    if (token.startsWith("#")) continue;
    if (!mode) continue;

    current[mode].push(token);
  }

  if (current) items.push(current);

  return items;
}

function tokenToSpoken(token) {
  const t = token.trim();
  if (!t) return "";
  if (t.toLowerCase() === "backspace") return "backspace";
  if (/^\d$/.test(t)) return t;
  if (/^[a-z]$/i.test(t)) return t.toUpperCase();
  return t;
}

function sequenceToNarration(sequence, label) {
  const intro = `Please press the following keys. ${label} now.`;
  const flow = sequence.map((token) => tokenToSpoken(token)).join(", ");
  return `${intro} ${flow}.`;
}

module.exports = {
  parseSequenceMarkdown,
  tokenToSpoken,
  sequenceToNarration
};
