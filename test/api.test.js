const request = require("supertest");
const fs = require("fs");
const path = require("path");

process.env.DB_PATH = path.join(__dirname, "test-db.json");
process.env.DEV_AUTH_BYPASS = "1";
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_MONTHLY_PRICE_ID = "";
process.env.STRIPE_YEARLY_PRICE_ID = "";
const { buildApp } = require("../src/server");

function resetDb() {
  fs.writeFileSync(process.env.DB_PATH, JSON.stringify({
    users: [],
    setupProgress: [],
    lockSessions: [],
    revealEvents: [],
    generatedSequences: [],
    billingProfiles: []
  }, null, 2));
}

describe("API flow", () => {
  const app = buildApp();
  const token = "dev-token";

  beforeEach(async () => {
    process.env.FORCE_BILLING_ENFORCEMENT = "0";
    resetDb();
  });

  it("blocks lock start before all required steps", async () => {
    const r = await request(app)
      .post("/lock/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ track: "study_focus", platform: "ios", durationHours: 4, completionAttestation: true });
    expect(r.status).toBe(400);
  });

  it("prevents early reveal and allows reveal when expired", async () => {
    const steps = await request(app)
      .get("/setup/steps?track=study_focus&platform=ios")
      .set("Authorization", `Bearer ${token}`);

    for (const step of steps.body.steps) {
      await request(app)
        .post(`/setup/steps/${step.id}/confirm`)
        .set("Authorization", `Bearer ${token}`)
        .send({ track: "study_focus", platform: "ios", acknowledgedRisk: true });
    }

    const start = await request(app)
      .post("/lock/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ track: "study_focus", platform: "ios", durationHours: 1, completionAttestation: true });
    expect(start.status).toBe(201);

    const earlyReveal = await request(app)
      .get("/passcode/reveal")
      .set("Authorization", `Bearer ${token}`);
    expect(earlyReveal.status).toBe(403);

    const db = JSON.parse(fs.readFileSync(process.env.DB_PATH, "utf8"));
    db.lockSessions[0].endsAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(process.env.DB_PATH, JSON.stringify(db, null, 2));

    const reveal = await request(app)
      .get("/passcode/reveal")
      .set("Authorization", `Bearer ${token}`);
    expect(reveal.status).toBe(200);
    expect(reveal.body.code).toMatch(/^\d{4}$/);
  });

  it("blocks setup when billing enforcement is enabled and no entitlement exists", async () => {
    process.env.FORCE_BILLING_ENFORCEMENT = "1";
    const r = await request(app)
      .get("/setup/steps?track=study_focus&platform=ios")
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("BILLING_REQUIRED");
  });

  it("allows setup when billing enforcement is enabled and user is entitled", async () => {
    process.env.FORCE_BILLING_ENFORCEMENT = "1";
    const entitledDb = JSON.parse(fs.readFileSync(process.env.DB_PATH, "utf8"));
    entitledDb.billingProfiles.push({
      id: "bp-1",
      userId: "dev-user-1",
      stripeCustomerId: "cus_test",
      subscriptionId: "sub_test",
      subscriptionStatus: "active",
      entitled: true,
      priceId: "price_test",
      currentPeriodEnd: null,
      trialEndsAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    fs.writeFileSync(process.env.DB_PATH, JSON.stringify(entitledDb, null, 2));

    const r = await request(app)
      .get("/setup/steps?track=study_focus&platform=ios")
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.steps)).toBe(true);
  });
});
