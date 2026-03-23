const fs = require("fs");
const path = require("path");

const FILE_PATHS = [
  path.join(__dirname, "..", "..", "Codes.txt"),
  path.join(__dirname, "..", "..", "51-100 screentime passcodes.txt")
];
let cache = null;

function parseCodesFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const list = [];

  for (let i = 0; i < lines.length; i += 1) {
    const title = lines[i].trim();
    const m = title.match(/^Code\s+(\d+)\s*\((\d{4})\)$/i);
    if (!m) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j += 1;
    if (j >= lines.length) break;

    const tokens = lines[j].trim().split(/\s+/).filter(Boolean);
    list.push({
      id: `code-${m[1]}`,
      index: Number(m[1]),
      title,
      code: m[2],
      tokens
    });
    i = j;
  }

  return list;
}

function parseCodes() {
  const byId = new Map();

  FILE_PATHS.forEach((filePath) => {
    parseCodesFromFile(filePath).forEach((sequence) => {
      byId.set(sequence.id, sequence);
    });
  });

  return [...byId.values()].sort((a, b) => a.index - b.index);
}

function getSequences() {
  if (!cache) cache = parseCodes();
  return cache;
}

function getRandomSequence() {
  const list = getSequences();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function getSequenceById(id) {
  return getSequences().find((s) => s.id === id);
}

module.exports = {
  getSequences,
  getRandomSequence,
  getSequenceById
};
