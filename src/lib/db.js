const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "db.json");

const EMPTY_DB = {
  users: [],
  setupProgress: [],
  lockSessions: [],
  revealEvents: [],
  generatedSequences: [],
  billingProfiles: []
};

function normalizeDb(db) {
  return {
    ...EMPTY_DB,
    ...db,
    users: Array.isArray(db?.users) ? db.users : [],
    setupProgress: Array.isArray(db?.setupProgress) ? db.setupProgress : [],
    lockSessions: Array.isArray(db?.lockSessions) ? db.lockSessions : [],
    revealEvents: Array.isArray(db?.revealEvents) ? db.revealEvents : [],
    generatedSequences: Array.isArray(db?.generatedSequences) ? db.generatedSequences : [],
    billingProfiles: Array.isArray(db?.billingProfiles) ? db.billingProfiles : []
  };
}

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
}

function readDb() {
  ensureDb();
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  return normalizeDb(parsed);
}

function writeDb(nextDb) {
  fs.writeFileSync(DB_PATH, JSON.stringify(nextDb, null, 2));
}

function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

module.exports = { readDb, writeDb, withDb, DB_PATH };
