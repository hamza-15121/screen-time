const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { randomUUID } = require("crypto");
const path = require("path");
const fs = require("fs");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile();

const { withDb, readDb } = require("./lib/db");
const { requireAuth, applyClerkMiddleware } = require("./lib/auth");
const { STEPS_BY_TRACK, TRACK_ORDER, PLATFORM_ORDER } = require("./lib/steps");
const { generatePuzzlePayload } = require("./lib/passcode");
const { getRandomSequence, getSequenceById, getSequences } = require("./lib/passcodeSequences");

const MIN_DURATION_MS = 60 * 60 * 1000;
const MAX_DURATION_MS = 90 * 24 * 60 * 60 * 1000;
const ENTITLED_STATUSES = new Set(["active", "trialing"]);
const DURATION_HOURS_BY_UNIT = {
  hours: 1,
  days: 24,
  months: 30 * 24
};

function getPublishableKey() {
  return process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
}

function msFromDuration(hours) {
  return hours * 60 * 60 * 1000;
}

function parseDurationInput(body) {
  const unit = String(body?.durationUnit || "").toLowerCase();
  const value = Number(body?.durationValue);

  if (unit && Number.isFinite(value) && DURATION_HOURS_BY_UNIT[unit]) {
    const durationHours = value * DURATION_HOURS_BY_UNIT[unit];
    return { durationHours, durationValue: value, durationUnit: unit };
  }

  const durationHours = Number(body?.durationHours);
  return { durationHours, durationValue: durationHours, durationUnit: "hours" };
}

function getStripeConfig() {
  const trialDaysRaw = Number(process.env.STRIPE_TRIAL_DAYS || 3);
  const trialDays = Number.isFinite(trialDaysRaw) && trialDaysRaw >= 0 ? Math.floor(trialDaysRaw) : 3;
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    priceId: process.env.STRIPE_MONTHLY_PRICE_ID || "",
    yearlyPriceId: process.env.STRIPE_YEARLY_PRICE_ID || "",
    siteUrl: process.env.APP_BASE_URL || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    trialDays,
    monthlyPriceDisplay: process.env.STRIPE_MONTHLY_PRICE_DISPLAY || "4.99",
    yearlyPriceDisplay: process.env.STRIPE_YEARLY_PRICE_DISPLAY || "39.99",
    currencyDisplay: process.env.STRIPE_CURRENCY_DISPLAY || "USD"
  };
}

function getStripeClient() {
  const { secretKey } = getStripeConfig();
  if (!secretKey) return null;
  // Lazy require keeps non-billing flows stable if Stripe package/env is missing.
  // eslint-disable-next-line global-require
  const Stripe = require("stripe");
  return new Stripe(secretKey);
}

function getOrCreateBillingProfile(userId) {
  let profile = readDb().billingProfiles.find((p) => p.userId === userId);
  if (!profile) {
    profile = {
      id: randomUUID(),
      userId,
      stripeCustomerId: null,
      subscriptionId: null,
      subscriptionStatus: "inactive",
      entitled: false,
      priceId: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    withDb((db) => {
      if (!Array.isArray(db.billingProfiles)) db.billingProfiles = [];
      db.billingProfiles.push(profile);
    });
  }
  return profile;
}

function isEntitledStatus(status) {
  return ENTITLED_STATUSES.has(String(status || "").toLowerCase());
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isFalsy(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function isBillingEnforcementEnabled() {
  const forced = process.env.FORCE_BILLING_ENFORCEMENT;
  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isTruthy(forced)) return true;
  if (isFalsy(forced)) return isProduction;

  const { secretKey, priceId, yearlyPriceId } = getStripeConfig();
  if (secretKey && (priceId || yearlyPriceId)) return true;

  // Fail closed in production: if billing env is missing, do not allow free access by mistake.
  return isProduction;
}

function getBillingProfileByUserId(userId) {
  return readDb().billingProfiles.find((p) => p.userId === userId) || null;
}

function getUserEntitlement(userId) {
  const profile = getBillingProfileByUserId(userId);
  if (!profile) return { entitled: false, status: "inactive", profile: null };
  const status = String(profile.subscriptionStatus || "inactive").toLowerCase();
  return { entitled: isEntitledStatus(status), status, profile };
}

function pickBestSubscription(subscriptions = []) {
  if (!Array.isArray(subscriptions) || !subscriptions.length) return null;
  const entitlementFirst = subscriptions.find((sub) => isEntitledStatus(sub?.status));
  if (entitlementFirst) return entitlementFirst;
  return subscriptions
    .slice()
    .sort((a, b) => Number(b?.created || 0) - Number(a?.created || 0))[0];
}

async function syncBillingProfileFromStripe(userId, checkoutSessionId = "") {
  const stripe = getStripeClient();
  if (!stripe) return { synced: false, reason: "stripe_not_configured" };

  const profile = getOrCreateBillingProfile(userId);
  let customerId = profile.stripeCustomerId || null;
  const sessionId = String(checkoutSessionId || "").trim();

  if (sessionId) {
    const checkout = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const metadataUserId = String(checkout?.metadata?.userId || "").trim();
    if (metadataUserId && metadataUserId !== userId) {
      throw new Error("Checkout session does not belong to current user.");
    }

    const sessionCustomerId = typeof checkout?.customer === "string"
      ? checkout.customer
      : checkout?.customer?.id || null;
    if (sessionCustomerId) {
      customerId = sessionCustomerId;
      withDb((db) => {
        const target = db.billingProfiles.find((p) => p.userId === userId);
        if (target) {
          target.stripeCustomerId = customerId;
          target.updatedAt = new Date().toISOString();
        }
      });
    }

    let subscription = checkout?.subscription || null;
    if (typeof subscription === "string" && subscription) {
      subscription = await stripe.subscriptions.retrieve(subscription);
    }
    if (subscription && subscription.id) {
      upsertBillingProfileFromSubscription(subscription, userId, customerId);
      return { synced: true, source: "checkout_session", subscriptionStatus: subscription.status };
    }
  }

  if (!customerId) return { synced: false, reason: "no_customer" };

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10
  });
  const selected = pickBestSubscription(listed?.data || []);
  if (!selected) return { synced: false, reason: "no_subscription" };

  upsertBillingProfileFromSubscription(selected, userId, customerId);
  return { synced: true, source: "customer_subscriptions", subscriptionStatus: selected.status };
}

function upsertBillingProfileFromSubscription(subscription, preferredUserId = null, preferredCustomerId = null) {
  const customerId = preferredCustomerId
    || (typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id || null);
  const status = String(subscription?.status || "inactive").toLowerCase();
  const nowIso = new Date().toISOString();
  const priceId = subscription?.items?.data?.[0]?.price?.id || null;
  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const trialEndsAt = subscription?.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : null;

  withDb((db) => {
    if (!Array.isArray(db.billingProfiles)) db.billingProfiles = [];
    let profile = null;
    if (subscription?.id) {
      profile = db.billingProfiles.find((p) => p.subscriptionId === subscription.id) || null;
    }
    if (!profile && customerId) {
      profile = db.billingProfiles.find((p) => p.stripeCustomerId === customerId) || null;
    }
    if (!profile && preferredUserId) {
      profile = db.billingProfiles.find((p) => p.userId === preferredUserId) || null;
    }
    if (!profile) {
      profile = {
        id: randomUUID(),
        userId: preferredUserId || null,
        stripeCustomerId: customerId || null,
        subscriptionId: null,
        subscriptionStatus: "inactive",
        entitled: false,
        priceId: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      db.billingProfiles.push(profile);
    }

    if (preferredUserId && !profile.userId) profile.userId = preferredUserId;
    if (customerId) profile.stripeCustomerId = customerId;
    profile.subscriptionId = subscription?.id || profile.subscriptionId || null;
    profile.subscriptionStatus = status;
    profile.entitled = isEntitledStatus(status);
    profile.priceId = priceId;
    profile.currentPeriodEnd = currentPeriodEnd;
    profile.trialEndsAt = trialEndsAt;
    profile.updatedAt = nowIso;
  });
}

function requirePaidAccess(req, res, next) {
  if (!isBillingEnforcementEnabled()) return next();
  const entitlement = getUserEntitlement(req.user.sub);
  if (entitlement.entitled) return next();
  return res.status(402).json({
    error: "Active subscription required. Start your 3-day free trial to continue.",
    code: "BILLING_REQUIRED",
    subscriptionStatus: entitlement.status
  });
}

function pickSequenceForSystem() {
  const all = getSequences();
  if (!all.length) return null;

  const db = readDb();
  const used = new Set((db.generatedSequences || []).map((e) => e.sequenceId));

  let pool = all.filter((s) => !used.has(s.id));
  if (!pool.length) {
    pool = all;
    withDb((nextDb) => {
      nextDb.generatedSequences = [];
    });
  }

  const selected = pool[Math.floor(Math.random() * pool.length)];
  withDb((nextDb) => {
    if (!Array.isArray(nextDb.generatedSequences)) nextDb.generatedSequences = [];
    nextDb.generatedSequences.push({
      id: randomUUID(),
      sequenceId: selected.id,
      generatedAt: new Date().toISOString()
    });
  });

  return selected;
}

function buildApp() {
  const app = express();
  app.use(cors());
  app.use(morgan("dev"));
  applyClerkMiddleware(app);
  app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const stripe = getStripeClient();
      const { webhookSecret } = getStripeConfig();
      if (!stripe || !webhookSecret) {
        return res.status(503).json({ error: "Stripe webhook is not configured." });
      }
      const signature = req.headers["stripe-signature"];
      if (!signature) return res.status(400).json({ error: "Missing Stripe signature header." });

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const userId = String(session?.metadata?.userId || "").trim() || null;
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          upsertBillingProfileFromSubscription(subscription, userId, customerId);
        }
      }

      if (
        event.type === "customer.subscription.created"
        || event.type === "customer.subscription.updated"
        || event.type === "customer.subscription.deleted"
      ) {
        upsertBillingProfileFromSubscription(event.data.object);
      }

      return res.json({ received: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Webhook processing failed." });
    }
  });
  app.use(express.json());

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.get("/auth/config", (req, res) => {
    return res.json({ publishableKey: getPublishableKey() });
  });

  app.get("/auth/me", requireAuth, (req, res) => {
    return res.json({ ok: true, userId: req.user.sub });
  });

  app.get("/billing/config", requireAuth, (req, res) => {
    const {
      priceId,
      yearlyPriceId,
      trialDays,
      monthlyPriceDisplay,
      yearlyPriceDisplay,
      currencyDisplay
    } = getStripeConfig();
    const profile = getOrCreateBillingProfile(req.user.sub);
    return res.json({
      enabled: !!getStripeClient() && (!!priceId || !!yearlyPriceId),
      enforcementEnabled: isBillingEnforcementEnabled(),
      monthlyPriceId: priceId || null,
      yearlyPriceId: yearlyPriceId || null,
      hasCustomer: !!profile.stripeCustomerId,
      subscriptionStatus: profile.subscriptionStatus || "inactive",
      entitled: isEntitledStatus(profile.subscriptionStatus),
      currentPeriodEnd: profile.currentPeriodEnd || null,
      trialEndsAt: profile.trialEndsAt || null,
      trialDays,
      monthlyPriceDisplay,
      yearlyPriceDisplay,
      currencyDisplay
    });
  });

  app.post("/billing/checkout", requireAuth, async (req, res) => {
    try {
      const stripe = getStripeClient();
      const { priceId, yearlyPriceId, siteUrl, trialDays } = getStripeConfig();
      const requestedPlan = String(req.body?.plan || "monthly").toLowerCase();
      const selectedPriceId = requestedPlan === "yearly" ? yearlyPriceId : priceId;
      const selectedPlan = requestedPlan === "yearly" ? "yearly" : "monthly";
      if (!stripe || !selectedPriceId) {
        return res.status(503).json({ error: "Billing is not configured yet." });
      }

      const profile = getOrCreateBillingProfile(req.user.sub);
      let customerId = profile.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { userId: req.user.sub }
        });
        customerId = customer.id;
        withDb((db) => {
          const target = db.billingProfiles.find((p) => p.userId === req.user.sub);
          if (target) {
            target.stripeCustomerId = customerId;
            target.updatedAt = new Date().toISOString();
          }
        });
      }

      const successUrl = String(req.body?.successUrl || siteUrl || "").trim() || "http://localhost:5000?billing=success";
      const cancelUrl = String(req.body?.cancelUrl || siteUrl || "").trim() || "http://localhost:5000?billing=cancel";
      const priorSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1
      });
      const hasPriorSubscription = Array.isArray(priorSubs?.data) && priorSubs.data.length > 0;
      const trialEligible = trialDays > 0 && !hasPriorSubscription;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: selectedPriceId, quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: trialEligible ? { trial_period_days: trialDays } : undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: req.user.sub, trialEligible: String(trialEligible), plan: selectedPlan }
      });

      return res.json({
        ok: true,
        checkoutUrl: session.url,
        checkoutSessionId: session.id,
        plan: selectedPlan,
        trialApplied: trialEligible,
        trialDays: trialEligible ? trialDays : 0
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Unable to start checkout session" });
    }
  });

  app.post("/billing/portal", requireAuth, async (req, res) => {
    try {
      const stripe = getStripeClient();
      if (!stripe) return res.status(503).json({ error: "Billing is not configured yet." });
      const { siteUrl } = getStripeConfig();
      const profile = getOrCreateBillingProfile(req.user.sub);
      if (!profile.stripeCustomerId) return res.status(400).json({ error: "No billing customer found. Start subscription first." });

      const returnUrl = String(req.body?.returnUrl || siteUrl || "").trim() || "http://localhost:5000";
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripeCustomerId,
        return_url: returnUrl
      });
      return res.json({ ok: true, portalUrl: portal.url });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Unable to open billing portal" });
    }
  });

  app.post("/billing/sync", requireAuth, async (req, res) => {
    try {
      const checkoutSessionId = String(req.body?.checkoutSessionId || "").trim();
      const result = await syncBillingProfileFromStripe(req.user.sub, checkoutSessionId);
      const entitlement = getUserEntitlement(req.user.sub);
      return res.json({
        ok: true,
        synced: !!result?.synced,
        source: result?.source || null,
        subscriptionStatus: entitlement.status,
        entitled: entitlement.entitled,
        enforcementEnabled: isBillingEnforcementEnabled()
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Unable to sync billing status." });
    }
  });

  app.get("/billing/entitlement", requireAuth, async (req, res) => {
    try {
      await syncBillingProfileFromStripe(req.user.sub);
    } catch {
      // Non-fatal: return last known local profile if sync fails.
    }
    const entitlement = getUserEntitlement(req.user.sub);
    return res.json({
      entitled: entitlement.entitled,
      subscriptionStatus: entitlement.status,
      enforcementEnabled: isBillingEnforcementEnabled(),
      profile: entitlement.profile
        ? {
          stripeCustomerId: entitlement.profile.stripeCustomerId || null,
          subscriptionId: entitlement.profile.subscriptionId || null,
          currentPeriodEnd: entitlement.profile.currentPeriodEnd || null,
          trialEndsAt: entitlement.profile.trialEndsAt || null
        }
        : null
    });
  });

  app.get("/setup/steps", requireAuth, requirePaidAccess, (req, res) => {
    const track = req.query.track;
    const platform = req.query.platform;

    if (!TRACK_ORDER.includes(track)) return res.status(400).json({ error: "Invalid track" });
    if (!PLATFORM_ORDER.includes(platform)) return res.status(400).json({ error: "Invalid platform" });

    const steps = STEPS_BY_TRACK[track].map((step, index) => ({
      id: step.id,
      order: index + 1,
      title: step.title,
      instruction: step.instructions[platform],
      risk: step.risk,
      optional: !!step.optional
    }));

    return res.json({ track, platform, steps });
  });

  app.post("/setup/steps/:id/confirm", requireAuth, requirePaidAccess, (req, res) => {
    const { track, platform, acknowledgedRisk } = req.body || {};
    const stepId = req.params.id;
    if (!TRACK_ORDER.includes(track) || !PLATFORM_ORDER.includes(platform)) return res.status(400).json({ error: "Invalid track/platform" });
    if (!acknowledgedRisk) return res.status(400).json({ error: "Risk warning must be acknowledged" });

    const stepIds = STEPS_BY_TRACK[track].map((s) => s.id);
    if (!stepIds.includes(stepId)) return res.status(404).json({ error: "Step not found" });

    const currentIndex = stepIds.indexOf(stepId);
    const requiredPrior = stepIds.slice(0, currentIndex);
    const completed = readDb().setupProgress
      .filter((s) => s.userId === req.user.sub && s.track === track && s.platform === platform)
      .map((s) => s.stepId);
    const missingPrior = requiredPrior.find((id) => !completed.includes(id));
    if (missingPrior) {
      return res.status(400).json({ error: "Steps must be confirmed in order" });
    }

    const already = readDb().setupProgress.find((s) => s.userId === req.user.sub && s.track === track && s.platform === platform && s.stepId === stepId);
    if (already) return res.json({ ok: true, alreadyConfirmed: true });

    withDb((db) => {
      db.setupProgress.push({
        id: randomUUID(),
        userId: req.user.sub,
        track,
        platform,
        stepId,
        acknowledgedRisk: true,
        confirmedAt: new Date().toISOString()
      });
    });
    return res.json({ ok: true });
  });

  app.post("/passcode/generate-script", requireAuth, requirePaidAccess, (req, res) => {
    const sequence = pickSequenceForSystem() || getRandomSequence();
    if (!sequence) return res.status(500).json({ error: "No passcode sequences available" });
    return res.json({
      id: sequence.id,
      index: sequence.index,
      title: sequence.title,
      tokens: sequence.tokens
    });
  });

  app.post("/lock/start", requireAuth, requirePaidAccess, (req, res) => {
    const { track, platform, completionAttestation, passcodeCode, passcodePayload, sequenceId, deviceName } = req.body || {};
    if (!TRACK_ORDER.includes(track) || !PLATFORM_ORDER.includes(platform)) return res.status(400).json({ error: "Invalid track/platform" });
    if (!completionAttestation) return res.status(400).json({ error: "Completion attestation required" });

    const { durationHours, durationValue, durationUnit } = parseDurationInput(req.body || {});
    const ms = msFromDuration(Number(durationHours));
    if (!Number.isFinite(ms) || ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
      return res.status(400).json({ error: "Duration must be between 1 hour and 3 months" });
    }

    const requiredSteps = STEPS_BY_TRACK[track].map((s) => s.id);
    const done = readDb().setupProgress
      .filter((s) => s.userId === req.user.sub && s.track === track && s.platform === platform)
      .map((s) => s.stepId);
    const allDone = requiredSteps.every((step) => done.includes(step));
    if (!allDone) return res.status(400).json({ error: "All required steps must be confirmed first" });

    const startedAt = Date.now();
    const endsAt = startedAt + ms;

    const selected = sequenceId ? getSequenceById(sequenceId) : (pickSequenceForSystem() || getRandomSequence());
    const fallbackPasscode = generatePuzzlePayload(passcodeCode && String(passcodeCode).length === 4 ? String(passcodeCode) : undefined);
    const passcode = selected
      ? { id: selected.id, code: selected.code, tokens: selected.tokens, source: "codes_file" }
      : passcodePayload && passcodePayload.code
        ? passcodePayload
        : fallbackPasscode;

    const lockSession = {
      id: randomUUID(),
      userId: req.user.sub,
      track,
      platform,
      durationHours: Number(durationHours),
      durationValue: Number(durationValue),
      durationUnit,
      deviceName: String(deviceName || "").trim() || null,
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      status: "locked",
      revealEligible: false,
      completionAttestation: true,
      passcode,
      sequenceId: selected ? selected.id : null
    };

    withDb((db) => {
      db.lockSessions.push(lockSession);
    });

    return res.status(201).json({
      lockSessionId: lockSession.id,
      deviceName: lockSession.deviceName,
      durationHours: lockSession.durationHours,
      durationValue: lockSession.durationValue,
      durationUnit: lockSession.durationUnit,
      startedAt: lockSession.startedAt,
      endsAt: lockSession.endsAt,
      status: lockSession.status
    });
  });

  app.get("/lock/status", requireAuth, (req, res) => {
    const sessions = readDb().lockSessions
      .filter((s) => s.userId === req.user.sub)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    if (!sessions.length) return res.json({ active: false });

    const now = Date.now();
    const needsUpdate = sessions.filter((s) => now >= new Date(s.endsAt).getTime() && s.status === "locked");
    if (needsUpdate.length) {
      withDb((db) => {
        db.lockSessions.forEach((entry) => {
          if (entry.userId !== req.user.sub) return;
          if (now >= new Date(entry.endsAt).getTime() && entry.status === "locked") {
            entry.status = "reveal_ready";
            entry.revealEligible = true;
          }
        });
      });
    }

    const normalized = readDb().lockSessions
      .filter((s) => s.userId === req.user.sub)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .map((session) => {
        const revealEligible = now >= new Date(session.endsAt).getTime() || !!session.revealEligible;
        return {
          id: session.id,
          track: session.track,
          platform: session.platform,
          deviceName: session.deviceName || null,
          durationHours: session.durationHours,
          durationValue: session.durationValue || session.durationHours,
          durationUnit: session.durationUnit || "hours",
          startedAt: session.startedAt,
          endsAt: session.endsAt,
          status: revealEligible && session.status === "locked" ? "reveal_ready" : session.status,
          revealEligible
        };
      });

    const activeSessions = normalized.filter((s) => s.status === "locked" || s.status === "reveal_ready");
    const primary = activeSessions[0] || normalized[0];

    return res.json({
      active: activeSessions.length > 0,
      sessions: normalized,
      id: primary.id,
      track: primary.track,
      platform: primary.platform,
      deviceName: primary.deviceName || null,
      durationHours: primary.durationHours,
      durationValue: primary.durationValue || primary.durationHours,
      durationUnit: primary.durationUnit || "hours",
      startedAt: primary.startedAt,
      endsAt: primary.endsAt,
      status: primary.status,
      revealEligible: primary.revealEligible
    });
  });

  app.get("/passcode/reveal", requireAuth, (req, res) => {
    const requestedId = String(req.query.lockSessionId || "").trim();
    const sorted = readDb().lockSessions
      .filter((s) => s.userId === req.user.sub)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const session = requestedId ? sorted.find((s) => s.id === requestedId) : sorted[0];

    if (!session) return res.status(404).json({ error: "No lock session" });

    const now = Date.now();
    const endsAt = new Date(session.endsAt).getTime();
    if (now < endsAt) return res.status(403).json({ error: "Reveal not available yet", endsAt: session.endsAt });

    withDb((db) => {
      const target = db.lockSessions.find((s) => s.id === session.id);
      if (target) {
        target.status = "revealed";
        target.revealEligible = true;
      }
      db.revealEvents.push({ id: randomUUID(), userId: req.user.sub, lockSessionId: session.id, revealedAt: new Date().toISOString() });
    });

    return res.json({ lockSessionId: session.id, code: session.passcode.code, revealedAt: new Date().toISOString() });
  });

  app.delete("/lock/device/:id", requireAuth, (req, res) => {
    const id = req.params.id;
    const db = readDb();
    const session = db.lockSessions.find((s) => s.id === id && s.userId === req.user.sub);
    if (!session) return res.status(404).json({ error: "Device lock not found" });
    if (session.status !== "revealed") {
      return res.status(400).json({ error: "Reveal passcode first, then delete this device lock." });
    }

    withDb((nextDb) => {
      nextDb.lockSessions = nextDb.lockSessions.filter((s) => !(s.id === id && s.userId === req.user.sub));
      nextDb.revealEvents = (nextDb.revealEvents || []).filter((e) => e.lockSessionId !== id);
    });

    return res.json({ ok: true, deletedLockSessionId: id });
  });

  app.use("/vendor/clerk", express.static(path.join(__dirname, "..", "node_modules", "@clerk", "clerk-js", "dist")));
  app.use(express.static(path.join(__dirname, "..", "public"), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
  }));
  app.use((req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

if (require.main === module) {
  const app = buildApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Scrrentime server listening on ${port}`);
  });
}

module.exports = { buildApp, MIN_DURATION_MS, MAX_DURATION_MS };

