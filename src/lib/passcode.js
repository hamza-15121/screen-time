const LETTER_TO_DIGIT = {
  A: "2",
  D: "3",
  G: "4",
  J: "5",
  M: "6",
  P: "7",
  T: "8",
  W: "9"
};

const DIGIT_TO_LETTER = Object.fromEntries(Object.entries(LETTER_TO_DIGIT).map(([k, v]) => [v, k]));

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDigitCode() {
  let out = "";
  for (let i = 0; i < 4; i += 1) out += String(randomInt(0, 9));
  return out;
}

function tokenForDigit(digit) {
  if (DIGIT_TO_LETTER[digit] && Math.random() < 0.5) return DIGIT_TO_LETTER[digit];
  return digit;
}

function generateEntryTokens(code) {
  const tokens = [];
  for (const digit of code) {
    const noiseCount = randomInt(1, 3);
    for (let i = 0; i < noiseCount; i += 1) {
      const noiseDigit = String(randomInt(0, 9));
      tokens.push(tokenForDigit(noiseDigit));
      tokens.push("BACKSPACE");
    }
    tokens.push(tokenForDigit(digit));
  }
  return tokens;
}

function resolveTokensToCode(tokens) {
  const out = [];
  for (const token of tokens) {
    if (token === "BACKSPACE") {
      out.pop();
      continue;
    }
    const upper = String(token).toUpperCase();
    if (LETTER_TO_DIGIT[upper]) out.push(LETTER_TO_DIGIT[upper]);
    else if (/^\d$/.test(upper)) out.push(upper);
  }
  return out.join("");
}

function generatePuzzlePayload(existingCode) {
  const code = existingCode || randomDigitCode();
  const first = generateEntryTokens(code);
  const second = generateEntryTokens(code);
  return {
    code,
    mapping: LETTER_TO_DIGIT,
    entryTokens: first,
    confirmTokens: second,
    resolvedEntry: resolveTokensToCode(first),
    resolvedConfirm: resolveTokensToCode(second)
  };
}

module.exports = {
  LETTER_TO_DIGIT,
  resolveTokensToCode,
  generatePuzzlePayload,
  randomDigitCode
};
