const { generatePuzzlePayload, resolveTokensToCode } = require("../src/lib/passcode");

describe("passcode puzzle", () => {
  it("resolves entry and confirm tokens to target code", () => {
    const payload = generatePuzzlePayload();
    expect(resolveTokensToCode(payload.entryTokens)).toBe(payload.code);
    expect(resolveTokensToCode(payload.confirmTokens)).toBe(payload.code);
    expect(payload.resolvedEntry).toBe(payload.code);
    expect(payload.resolvedConfirm).toBe(payload.code);
  });

  it("supports explicit code", () => {
    const payload = generatePuzzlePayload("2468");
    expect(resolveTokensToCode(payload.entryTokens)).toBe("2468");
  });
});
