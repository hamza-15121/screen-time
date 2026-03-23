const API = "";
let countdownTimer = null;
let clerkClient = null;
let clerkPublishableKey = "";
const authTokenCache = {
  value: "",
  expiresAt: 0,
  pending: null
};
const DURATION_HOURS_BY_UNIT = {
  hours: 1,
  days: 24,
  months: 30 * 24
};

const state = {
  phase: "config",
  track: "study_focus",
  platform: "ios",
  deviceName: "",
  durationValue: 4,
  durationUnit: "hours",
  steps: [],
  stepIndex: 0,
  selectedSequence: null,
  passcodePrimerAccepted: false,
  runner: {
    index: 0,
    appleScreen: 1,
    typedCount: 0
  },
  selectedLockId: "",
  lock: null,
  locks: [],
  revealedCode: "",
  revealedCodeById: "",
  billingEntitled: false,
  billingEnforcementEnabled: true,
  billingSubscriptionStatus: "inactive"
};

const phaseMeta = {
  config: {
    title: "Configuration",
    tag: "Config",
    lead: "Choose lane, platform, device name, and lock duration before guided setup starts."
  },
  steps: {
    title: "Manual Hardening",
    tag: "Step",
    lead: "Complete one Apple settings step per screen. Check the box before continuing."
  },
  passcode: {
    title: "Passcode Sequence",
    tag: "Entry",
    lead: "Follow each token live in Apple Screen Time. Do not pause to memorize."
  },
  passcode_intro: {
    title: "Passcode Key",
    tag: "Guide",
    lead: "Understand the keypad letter mapping before entering the passcode sequence."
  },
  locked: {
    title: "Lock Active",
    tag: "Timer",
    lead: "Your lock is active. Passcode reveal remains blocked until timer expiry."
  },
  dashboard: {
    title: "Device Dashboard",
    tag: "Devices",
    lead: "See each added device, timer state, and remaining time. Add more devices anytime."
  }
};

const $ = (id) => document.getElementById(id);

function setMsg(el, text, isError = false) {
  el.textContent = text || "";
  el.className = isError ? "msg warn" : "msg";
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toMs(hours) {
  return Number(hours) * 60 * 60 * 1000;
}

function durationBounds(unit) {
  if (unit === "days") return { min: 1, max: 90, label: "Allowed range: 1 to 90 days." };
  if (unit === "months") return { min: 1, max: 3, label: "Allowed range: 1 to 3 months." };
  return { min: 1, max: 2160, label: "Allowed range: 1 to 2160 hours." };
}

function durationToHours(value, unit) {
  return Number(value) * (DURATION_HOURS_BY_UNIT[unit] || 1);
}

function formatDuration(value, unit) {
  const n = Number(value);
  const suffix = n === 1 ? unit.slice(0, -1) : unit;
  return `${n} ${suffix}`;
}

function formatRemaining(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function canCreateDevice() {
  return !state.billingEnforcementEnabled || state.billingEntitled;
}

function updatePhaseChrome() {
  const meta = phaseMeta[state.phase];
  const titleEl = $("phaseTitle");
  const tagEl = $("phaseTag");
  const leadEl = $("phaseLead");
  if (state.phase === "steps") {
    titleEl.classList.add("hidden");
    tagEl.classList.add("hidden");
    leadEl.classList.add("hidden");
    titleEl.textContent = "";
    tagEl.textContent = "";
    leadEl.textContent = "";
    return;
  }
  titleEl.classList.remove("hidden");
  tagEl.classList.remove("hidden");
  leadEl.classList.remove("hidden");
  titleEl.textContent = meta.title;
  tagEl.textContent = meta.tag;
  leadEl.textContent = meta.lead;
}

async function getAuthToken() {
  if (!clerkClient || !clerkClient.session) return "";
  if (authTokenCache.value && Date.now() < authTokenCache.expiresAt) {
    return authTokenCache.value;
  }
  if (authTokenCache.pending) return authTokenCache.pending;

  authTokenCache.pending = (async () => {
    try {
      const token = (await clerkClient.session.getToken()) || "";
      authTokenCache.value = token;
      authTokenCache.expiresAt = Date.now() + 25_000;
      return token;
    } catch {
      authTokenCache.value = "";
      authTokenCache.expiresAt = 0;
      return "";
    } finally {
      authTokenCache.pending = null;
    }
  })();

  try {
    return await authTokenCache.pending;
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  headers["Content-Type"] = "application/json";
  const token = await getAuthToken();
  if (!token) {
    await renderAuth();
    throw new Error("No active session. Please sign in again.");
  }
  headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers, credentials: "include" });
  if (res.status === 401) {
    authTokenCache.value = "";
    authTokenCache.expiresAt = 0;
    await renderAuth();
    throw new Error("Unauthorized. Please sign in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

function showAuth() {
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("topSignInBtn").classList.remove("hidden");
  $("topSignUpBtn").classList.remove("hidden");
  $("logoutBtn").classList.add("hidden");
  $("manageBillingTopBtn").classList.add("hidden");
  $("manageAccountTopBtn").classList.add("hidden");
}

function showApp() {
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("topSignInBtn").classList.add("hidden");
  $("topSignUpBtn").classList.add("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("manageBillingTopBtn").classList.remove("hidden");
  $("manageAccountTopBtn").classList.remove("hidden");
}

function renderConfig() {
  state.phase = "config";
  updatePhaseChrome();
  const bounds = durationBounds(state.durationUnit);
  $("wizard").innerHTML = `
    <div class="choice-board">
      <h4>Lock Mode Strategy</h4>
      <div class="choice-grid">
        <div class="choice-tile">
          <strong>Complete Lock</strong>
          Set all app/categories limits to zero for a full blockout. Use only if you want strict lock behavior.
        </div>
        <div class="choice-tile">
          <strong>Selective Lock</strong>
          Pick specific apps/categories to allow or limit, and choose custom time windows for each.
        </div>
      </div>
    </div>
    <div class="grid grid-2">
      <div>
        <label>Lane</label>
        <select id="trackSelect">
          <option value="study_focus">Study Focus</option>
          <option value="control_screentime">Screen Time Control</option>
          <option value="adult_content_block">Adult Content Block</option>
        </select>
      </div>
      <div>
        <label>Platform</label>
        <select id="platformSelect">
          <option value="ios">iPhone (iOS)</option>
          <option value="ipados">iPad (iPadOS)</option>
          <option value="macos">Mac (macOS)</option>
        </select>
      </div>
    </div>
    <div class="grid" style="margin-top:12px;">
      <div>
        <label>Device Name (optional)</label>
        <input id="deviceName" type="text" maxlength="60" placeholder="Example: Ali iPhone 15" value="${escapeHtml(state.deviceName)}" />
      </div>
      <div class="grid grid-2">
        <div>
          <label>Lock Duration</label>
          <input id="durationValue" type="number" min="${bounds.min}" max="${bounds.max}" step="1" value="${state.durationValue}" />
        </div>
        <div>
          <label>Unit</label>
          <select id="durationUnit">
            <option value="hours">Hours</option>
            <option value="days">Days</option>
            <option value="months">Months</option>
          </select>
        </div>
      </div>
      <p id="durationHelp" class="subtle">${bounds.label}</p>
      <label class="inline">
        <input id="consentStart" type="checkbox" />
        <span>I understand this app provides guidance only, lockout risk is mine, and reveal is blocked until timer expiry.</span>
      </label>
      <button id="beginSetupBtn">Begin Guided Setup</button>
    </div>
  `;

  $("trackSelect").value = state.track;
  $("platformSelect").value = state.platform;
  $("durationUnit").value = state.durationUnit;
  $("durationUnit").onchange = () => {
    const unit = $("durationUnit").value;
    const next = durationBounds(unit);
    $("durationValue").min = String(next.min);
    $("durationValue").max = String(next.max);
    $("durationHelp").textContent = next.label;
  };
  $("beginSetupBtn").onclick = beginSetup;
}

function renderStep() {
  state.phase = "steps";
  updatePhaseChrome();
  const step = state.steps[state.stepIndex];
  if (!step) {
    renderPasscodePrimer();
    return;
  }
  const normalizedStep = step.id === "find_my_toggle"
    ? {
      ...step,
      title: "Turn OFF Find My Device",
      instruction: "Settings > [Your Name] > Find My > Find My iPhone. Turn OFF Find My Device. Install Life360 from the Apple App Store if you still want location sharing.",
      risk: "Leaving Find My ON can allow bypass routes. Turn it OFF before continuing for stronger lock resistance.",
      optional: false
    }
    : step;

  const progressPct = Math.round((normalizedStep.order / state.steps.length) * 100);
  const pathText = getStepPath(normalizedStep);
  const pathBody = getStepBody(normalizedStep.instruction);
  const isFinalStep = state.stepIndex === state.steps.length - 1;
  const appLimitChoices = normalizedStep.id === "app_limits_zero"
    ? `
      <div class="choice-board">
        <h4>App Limit Options You Can Choose</h4>
        <div class="choice-grid">
          <div class="choice-tile">
            <strong>Complete Blockout</strong>
            Set all apps and categories to zero or minimum allowed, then enable <em>Block at End of Limit</em>.
          </div>
          <div class="choice-tile">
            <strong>Custom Plan</strong>
            Allow selected apps and define specific limits per app/category based on your daily needs.
          </div>
        </div>
      </div>
    `
    : "";
  const webChoices = normalizedStep.id === "web_allowed_only"
    ? `
      <div class="choice-board">
        <h4>Web Filter Mode</h4>
        <div class="choice-grid">
          <div class="choice-tile">
            <strong>Hardcore Blackout</strong>
            Set <em>Allowed Websites Only</em> to aggressively lock browsing to a controlled allowlist.
          </div>
          <div class="choice-tile">
            <strong>Adult Content Only</strong>
            Set <em>Limit Adult Websites</em> if you only want adult-content filtering while keeping broader web access.
          </div>
        </div>
      </div>
    `
    : "";
  const appLimitAck = normalizedStep.id === "app_limits_zero"
    ? `
      <label class="inline">
        <input id="blockAtEndAck" type="checkbox" />
        <span>I have enabled Block at End of Limit.</span>
      </label>
    `
    : "";
  const termsNotice = normalizedStep.id === "recovery_notice"
    ? `
      <div class="terms-board">
        <h4>Terms and Conditions (Required)</h4>
        <ul>
          <li>This product provides guidance and timer tooling only; it does not directly control Apple systems.</li>
          <li>You are fully responsible for passcode entry, account credentials, account recovery routes, and device access outcomes.</li>
          <li>Lockout can occur. You accept all risk of temporary or extended lockout resulting from your chosen settings.</li>
          <li>No guarantee is made that any setup is fully unbypassable on every device, OS version, or account state.</li>
          <li>You agree to use this service lawfully and at your own risk, and you are responsible for data/device consequences.</li>
          <li>By continuing, you acknowledge these terms and consent to continue under this responsibility model.</li>
        </ul>
      </div>
      <label class="inline">
        <input id="termsAck" type="checkbox" />
        <span>I have read, understood, and accepted the Terms and Conditions above.</span>
      </label>
    `
    : "";

  $("wizard").innerHTML = `
    <div class="step-shell">
      <h3 class="step-title">${escapeHtml(normalizedStep.title)}</h3>
      <div class="step-top">
        <span class="tag">Step ${normalizedStep.order} / ${state.steps.length}</span>
      </div>
      <div class="step-progress">
        <div class="step-progress-fill" style="width:${progressPct}%;"></div>
      </div>
      <div class="path-board">
        <p class="path-label">Start here:</p>
        <div class="path-row">${renderPathChips(pathText)}</div>
      </div>
      <p class="step-body">${escapeHtml(pathBody)}</p>
      ${appLimitChoices}
      ${webChoices}
      ${termsNotice}
      <div class="callout callout-warn"><strong>Risk:</strong> ${escapeHtml(normalizedStep.risk)}</div>
      <label class="inline">
        <input id="stepAck" type="checkbox" />
        <span>I have completed this step.</span>
      </label>
      ${appLimitAck}
      <div class="row">
        <button id="nextStepBtn" disabled>${isFinalStep ? "Confirm and Open Passcode Sequence" : "Confirm and Next"}</button>
      </div>
    </div>
  `;

  const ack = $("stepAck");
  const nextBtn = $("nextStepBtn");
  const blockAck = $("blockAtEndAck");
  const termsAck = $("termsAck");
  const updateBtnState = () => {
    const mustHaveBlockAck = !!blockAck;
    const mustHaveTermsAck = !!termsAck;
    nextBtn.disabled = !ack.checked || (mustHaveBlockAck && !blockAck.checked) || (mustHaveTermsAck && !termsAck.checked);
  };
  ack.onchange = updateBtnState;
  if (blockAck) blockAck.onchange = updateBtnState;
  if (termsAck) termsAck.onchange = updateBtnState;
  updateBtnState();
  $("nextStepBtn").onclick = confirmCurrentStep;
}

function getStepPath(step) {
  const raw = String(step.instruction || "");
  let candidate = raw.split(".")[0].trim();
  if (!candidate.includes(">")) {
    candidate = step.id === "recovery_notice" ? "Screen Time > Change Screen Time Passcode" : "Screen Time";
  }
  const needsPrefix = !/^Settings|^System Settings|^Screen Time/i.test(candidate);
  const prefixed = needsPrefix ? `Screen Time > ${candidate}` : candidate;
  return prefixed.replace(/\s*>\s*/g, " > ");
}

function getStepBody(instruction) {
  const raw = String(instruction || "").trim();
  const dot = raw.indexOf(".");
  if (dot === -1 || dot === raw.length - 1) {
    return "Use the highlighted path above, apply the setting, then continue.";
  }
  return raw.slice(dot + 1).trim();
}

function renderPathChips(pathText) {
  const parts = String(pathText || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return `<span class="path-chip">Screen Time</span>`;
  return parts
    .map((part, idx) => {
      const chip = `<span class="path-chip">${escapeHtml(part)}</span>`;
      if (idx === parts.length - 1) return chip;
      return `${chip}<span class="path-arrow">></span>`;
    })
    .join("");
}

function applyTokenToMeter(tokenText) {
  const t = tokenText.trim().toLowerCase();
  if (t === "backspace") {
    state.runner.typedCount = Math.max(0, state.runner.typedCount - 1);
    return;
  }
  state.runner.typedCount = Math.min(4, state.runner.typedCount + 1);
  if (state.runner.typedCount === 4 && state.runner.appleScreen === 1) {
    state.runner.appleScreen = 2;
    state.runner.typedCount = 0;
  }
}

function currentToken() {
  if (!state.selectedSequence) return "";
  return state.selectedSequence.tokens[state.runner.index] || "";
}

function formatTokenForDisplay(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  if (/^[adgjmptw]$/i.test(value)) return value.toUpperCase();
  if (/^backspace$/i.test(value)) return "BACKSPACE";
  return value;
}

function displaySequenceTitle(title) {
  return String(title || "").replace(/\s*\(\d{4}\)\s*/g, "").trim();
}

function renderPasscodeRunner() {
  if (!state.passcodePrimerAccepted) {
    renderPasscodePrimer();
    return;
  }
  state.phase = "passcode";
  updatePhaseChrome();
  const seq = state.selectedSequence;
  if (!seq) {
    $("wizard").innerHTML = `<p class="warn">No sequence loaded. Return to config and retry.</p>`;
    return;
  }

  const done = state.runner.index >= seq.tokens.length;
  const activeToken = done ? "SEQUENCE COMPLETE" : formatTokenForDisplay(currentToken());
  const fillPct = Math.round((state.runner.typedCount / 4) * 100);
  const completionRecoveryBanner = done
    ? `
      <div class="completion-recovery-banner">
        <strong>Important:</strong> Apple may ask for recovery email/password.
        Press <strong>Skip</strong> and do <strong>not</strong> enter any recovery email or password.
      </div>
    `
    : "";

  $("wizard").innerHTML = `
    <p class="subtle">Selected pathway: ${escapeHtml(displaySequenceTitle(seq.title))}. The actual 4-digit passcode is hidden until timer expiry.</p>
    <div class="token-stage">
      <p class="token-word">${escapeHtml(activeToken)}</p>
      <p class="token-meta">
        Token ${Math.min(state.runner.index + 1, seq.tokens.length)} of ${seq.tokens.length}
      </p>
      ${completionRecoveryBanner}
    </div>
    <div class="meter">
      <p class="subtle">Apple screen: ${state.runner.appleScreen} of 2 | Digits currently entered: ${state.runner.typedCount} / 4</p>
      <div class="meter-bar"><div class="meter-fill" style="width:${fillPct}%"></div></div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button id="runnerNextBtn" ${done ? "disabled" : ""}>Next</button>
      <button id="runnerResetBtn" class="ghost">Reset Sequence</button>
      <button id="regenPasscodeBtn" class="ghost">Generate Different Passcode</button>
    </div>
    <label class="inline" style="margin-top:12px;">
      <input id="runnerDoneAck" type="checkbox" ${done ? "" : "disabled"} />
      <span>I have entered the full sequence live in Apple Screen Time and completed confirmation.</span>
    </label>
    <label class="inline" style="margin-top:10px;">
      <input id="runnerRecoveryAck" type="checkbox" ${done ? "" : "disabled"} />
      <span>I confirm I have not added any recovery email and password.</span>
    </label>
    <button id="startLockBtn" style="margin-top:10px;" ${done ? "" : "disabled"}>Start Lock Timer</button>
  `;

  $("runnerNextBtn").onclick = nextRunnerToken;
  $("runnerResetBtn").onclick = resetRunner;
  $("regenPasscodeBtn").onclick = regeneratePasscodeSequence;
  $("startLockBtn").onclick = startLock;
}

function renderPasscodePrimer() {
  state.phase = "passcode_intro";
  updatePhaseChrome();
  $("wizard").innerHTML = `
    <div class="choice-board">
      <h4>How Letter Tokens Work on Apple Keypad</h4>
      <p class="subtle">On Apple passcode keypad, each number has letters beneath it. We only use the first letter of each number group.</p>
      <div class="mapping-grid">
        <div class="mapping-item"><strong>A</strong><span>= 2</span></div>
        <div class="mapping-item"><strong>D</strong><span>= 3</span></div>
        <div class="mapping-item"><strong>G</strong><span>= 4</span></div>
        <div class="mapping-item"><strong>J</strong><span>= 5</span></div>
        <div class="mapping-item"><strong>M</strong><span>= 6</span></div>
        <div class="mapping-item"><strong>P</strong><span>= 7</span></div>
        <div class="mapping-item"><strong>T</strong><span>= 8</span></div>
        <div class="mapping-item"><strong>W</strong><span>= 9</span></div>
      </div>
      <p class="subtle">Example: if token says <strong>J</strong>, enter <strong>5</strong>. If token says <strong>BACKSPACE</strong>, press delete once.</p>
    </div>
    <div class="row" style="margin-top:12px;">
      <button id="beginPasscodeEntryBtn">I Understand, Start Passcode Entry</button>
    </div>
  `;
  $("beginPasscodeEntryBtn").onclick = () => {
    state.passcodePrimerAccepted = true;
    renderPasscodeRunner();
  };
}

async function regeneratePasscodeSequence() {
  try {
    const sequenceOut = await api("/passcode/generate-script", { method: "POST", body: JSON.stringify({}) });
    state.selectedSequence = sequenceOut;
    state.passcodePrimerAccepted = false;
    state.runner = { index: 0, appleScreen: 1, typedCount: 0 };
    setMsg($("appMsg"), "New passcode sequence generated.");
    renderPasscodePrimer();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

function renderDashboard() {
  state.phase = "dashboard";
  updatePhaseChrome();
  const locks = Array.isArray(state.locks) && state.locks.length ? state.locks : [];
  const active = locks.filter((l) => l.status === "locked" || l.status === "reveal_ready");
  const archived = locks.filter((l) => l.status === "revealed");
  const allowAddDevice = canCreateDevice();
  const addDeviceButton = allowAddDevice ? `<button id="addDeviceBtn">Add Another Device</button>` : "";
  const trialGateNotice = allowAddDevice
    ? ""
    : `<p class="warn">Start your 3-day trial first to add a device and create a new Screen Time block.</p>`;
  const renderCards = (list, heading) => {
    if (!list.length) return "";
    const cards = list.map((lock, idx) => {
      const remain = formatRemaining(new Date(lock.endsAt).getTime() - Date.now());
      const rawName = String(lock.deviceName || "").trim();
      const deviceLabel = rawName ? escapeHtml(rawName) : `Device ${idx + 1}`;
      const shortTrack = escapeHtml(String(lock.track || "").replaceAll("_", " "));
      return `
        <article class="lock-card">
          <div class="lock-card-head">
            <h4>${deviceLabel}</h4>
            <span class="tag">${escapeHtml(lock.status || "locked")}</span>
          </div>
          <div class="lock-meta-row">
            <span class="meta-pill">Platform: ${escapeHtml(lock.platform)}</span>
            <span class="meta-pill">Track: ${shortTrack}</span>
          </div>
          <p class="clock-readout">Remaining <strong data-countdown-id="${escapeHtml(lock.id)}">${remain}</strong></p>
          <button class="open-device-btn" data-lock-id="${escapeHtml(lock.id)}">Open Device</button>
        </article>
      `;
    }).join("");
    return `<div class="dashboard-block"><h4 class="dashboard-title">${heading}</h4><div class="lock-grid">${cards}</div></div>`;
  };

  $("wizard").innerHTML = `
    <div class="lock-hero">
      <div class="clock-graphic" aria-hidden="true">
        <svg viewBox="0 0 180 180" role="img">
          <circle cx="90" cy="90" r="78" fill="#fff8ec" stroke="#d2d8ce" stroke-width="4"/>
          <circle cx="90" cy="90" r="9" fill="#0f766e"/>
          <line x1="90" y1="90" x2="90" y2="44" stroke="#0f766e" stroke-width="6" stroke-linecap="round"/>
          <line x1="90" y1="90" x2="126" y2="106" stroke="#e84e3a" stroke-width="6" stroke-linecap="round"/>
          <circle cx="90" cy="90" r="60" fill="none" stroke="#f3b433" stroke-width="3" stroke-dasharray="6 8"/>
        </svg>
      </div>
      <div>
        <p class="subtle">Devices added: <strong>${locks.length}</strong> | Active timers: <strong>${active.length}</strong></p>
        <p class="subtle">Click any device to view timer details and actions.</p>
      </div>
    </div>
    ${locks.length ? renderCards(active, `Active Devices (${active.length})`) : `<p class="subtle">No devices added yet. Add your first device to start.</p>`}
    ${renderCards(archived, "Revealed Devices")}
    ${trialGateNotice}
    <div class="row dashboard-actions">
      ${addDeviceButton}
      <button id="startMonthlyBtn">Start 3-Day Trial ($4.99/mo)</button>
      <button id="startYearlyBtn" class="ghost">Start 3-Day Trial ($39.99/year)</button>
    </div>
  `;
  if ($("addDeviceBtn")) $("addDeviceBtn").onclick = addAnotherDevice;
  $("startMonthlyBtn").onclick = () => startPlan("monthly");
  $("startYearlyBtn").onclick = () => startPlan("yearly");
  document.querySelectorAll(".open-device-btn").forEach((btn) => {
    btn.onclick = () => openDeviceDetail(btn.dataset.lockId);
  });
  startCountdownTicker();
}

function renderDeviceDetail() {
  state.phase = "locked";
  updatePhaseChrome();
  const lock = (state.locks || []).find((l) => l.id === state.selectedLockId) || state.lock;
  if (!lock) {
    renderDashboard();
    return;
  }
  const remain = formatRemaining(new Date(lock.endsAt).getTime() - Date.now());
  const durationLabel = formatDuration(lock.durationValue || lock.durationHours || 1, lock.durationUnit || "hours");
  const revealEnabled = !!lock.revealEligible || Date.now() >= new Date(lock.endsAt).getTime();
  const revealed = state.revealedCode && state.revealedCodeById === lock.id
    ? `<p class="mono"><strong>Revealed passcode:</strong> ${escapeHtml(state.revealedCode)}</p>`
    : "";
  const showDelete = lock.status === "revealed";
  const allowAddDevice = canCreateDevice();
  const revealHintText = revealEnabled ? "Timer expired. Reveal is now available." : "Reveal is blocked until timer expires.";
  const revealHintClass = revealEnabled ? "msg" : "warn";

  $("wizard").innerHTML = `
    <div class="lock-hero">
      <div class="clock-graphic" aria-hidden="true">
        <svg viewBox="0 0 180 180" role="img">
          <circle cx="90" cy="90" r="78" fill="#fff8ec" stroke="#d2d8ce" stroke-width="4"/>
          <circle cx="90" cy="90" r="9" fill="#0f766e"/>
          <line x1="90" y1="90" x2="90" y2="44" stroke="#0f766e" stroke-width="6" stroke-linecap="round"/>
          <line x1="90" y1="90" x2="126" y2="106" stroke="#e84e3a" stroke-width="6" stroke-linecap="round"/>
          <circle cx="90" cy="90" r="60" fill="none" stroke="#f3b433" stroke-width="3" stroke-dasharray="6 8"/>
        </svg>
      </div>
      <div>
        <h4>${escapeHtml(lock.deviceName || "Unnamed Device")}</h4>
        <p class="subtle">Track: ${escapeHtml(lock.track)} | Platform: ${escapeHtml(lock.platform)}</p>
        <p class="subtle">Configured duration: ${escapeHtml(durationLabel)}</p>
        <p class="clock-readout">Time remaining: <strong data-countdown-id="${escapeHtml(lock.id)}">${remain}</strong></p>
        <p class="subtle">Ends at ${new Date(lock.endsAt).toLocaleString()}</p>
      </div>
    </div>
    <div class="row">
      <button id="revealBtn" ${revealEnabled ? "" : "disabled"}>Reveal Passcode</button>
      <button id="deleteDeviceBtn" class="ghost" ${showDelete ? "" : "disabled"}>Delete Device</button>
      <button id="backDashboardBtn" class="ghost">Back to Dashboard</button>
      ${allowAddDevice ? `<button id="addDeviceBtn">Add Another Device</button>` : ""}
    </div>
    ${revealed}
    <p id="revealHint" class="${revealHintClass}">${escapeHtml(revealHintText)}</p>
  `;
  $("revealBtn").onclick = () => revealCode(lock.id);
  $("deleteDeviceBtn").onclick = () => deleteDevice(lock.id);
  $("backDashboardBtn").onclick = renderDashboard;
  if ($("addDeviceBtn")) $("addDeviceBtn").onclick = addAnotherDevice;
  startCountdownTicker();
}

function openDeviceDetail(lockId) {
  state.selectedLockId = lockId;
  renderDeviceDetail();
}

function startCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (!state.locks || !state.locks.length) return;
    state.locks.forEach((lock) => {
      const label = document.querySelector(`[data-countdown-id="${lock.id}"]`);
      if (!label) return;
      const remain = new Date(lock.endsAt).getTime() - Date.now();
      label.textContent = formatRemaining(remain);
      if (state.selectedLockId === lock.id && remain <= 0) {
        const revealBtn = $("revealBtn");
        if (revealBtn) revealBtn.disabled = false;
        const revealHint = $("revealHint");
        if (revealHint) {
          revealHint.className = "msg";
          revealHint.textContent = "Timer expired. Reveal is now available.";
        }
      }
    });
  }, 1000);
}

function stopCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function loadScript(src, publishableKey) {
  return new Promise((resolve, reject) => {
    window.__clerk_publishable_key = publishableKey;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute("data-clerk-publishable-key", publishableKey);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureClerkLoaded(publishableKey) {
  if (window.Clerk) return;
  const sources = [
    "/vendor/clerk/clerk.browser.js",
    "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js",
    "https://unpkg.com/@clerk/clerk-js@latest/dist/clerk.browser.js"
  ];

  let lastError = null;
  for (const src of sources) {
    try {
      await loadScript(src, publishableKey);
      if (window.Clerk) return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Unable to load Clerk script.");
}

async function logout() {
  stopCountdownTicker();
  state.lock = null;
  state.revealedCode = "";
  authTokenCache.value = "";
  authTokenCache.expiresAt = 0;
  if (clerkClient) await clerkClient.signOut({ redirectUrl: window.location.origin });
  await renderAuth();
}

async function beginSetup() {
  try {
    const durationValue = Number($("durationValue").value);
    const durationUnit = $("durationUnit").value;
    const bounds = durationBounds(durationUnit);
    if (!Number.isFinite(durationValue) || durationValue < bounds.min || durationValue > bounds.max) {
      throw new Error(bounds.label.replace("Allowed range: ", "Duration must be "));
    }
    const durationHours = durationToHours(durationValue, durationUnit);
    if (!Number.isFinite(durationHours) || toMs(durationHours) < 3600000 || toMs(durationHours) > 7776000000) {
      throw new Error("Duration must be between 1 hour and 3 months.");
    }
    if (!$("consentStart").checked) {
      throw new Error("You must accept the lockout and reveal notice first.");
    }

    state.track = $("trackSelect").value;
    state.platform = $("platformSelect").value;
    state.deviceName = $("deviceName").value.trim();
    state.durationValue = durationValue;
    state.durationUnit = durationUnit;
    state.stepIndex = 0;
    state.passcodePrimerAccepted = false;
    state.revealedCode = "";
    state.runner = { index: 0, appleScreen: 1, typedCount: 0 };

    const [stepOut, sequenceOut] = await Promise.all([
      api(`/setup/steps?track=${state.track}&platform=${state.platform}`),
      api("/passcode/generate-script", { method: "POST", body: JSON.stringify({}) })
    ]);

    state.steps = stepOut.steps || [];
    state.selectedSequence = sequenceOut;
    renderStep();
    setMsg($("appMsg"), "");
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

async function confirmCurrentStep() {
  try {
    if (!$("stepAck").checked) throw new Error("Check completion before moving to the next step.");
    const blockAck = $("blockAtEndAck");
    if (blockAck && !blockAck.checked) throw new Error("Confirm that Block at End of Limit is enabled.");
    const termsAck = $("termsAck");
    if (termsAck && !termsAck.checked) throw new Error("You must accept the Terms and Conditions before continuing.");
    const step = state.steps[state.stepIndex];
    await api(`/setup/steps/${step.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ track: state.track, platform: state.platform, acknowledgedRisk: true })
    });
    state.stepIndex += 1;
    if (state.stepIndex >= state.steps.length) {
      if (!state.selectedSequence) {
        const sequenceOut = await api("/passcode/generate-script", { method: "POST", body: JSON.stringify({}) });
        state.selectedSequence = sequenceOut;
      }
      state.passcodePrimerAccepted = false;
      setMsg($("appMsg"), "Setup complete. Passcode sequence is now ready.");
      renderPasscodePrimer();
      return;
    }
    renderStep();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

function nextRunnerToken() {
  if (!state.selectedSequence) return;
  if (state.runner.index >= state.selectedSequence.tokens.length) return;
  applyTokenToMeter(state.selectedSequence.tokens[state.runner.index]);
  state.runner.index += 1;
  renderPasscodeRunner();
}

function resetRunner() {
  state.runner = { index: 0, appleScreen: 1, typedCount: 0 };
  renderPasscodeRunner();
}

async function startLock() {
  try {
    const doneAck = $("runnerDoneAck");
    if (!doneAck || !doneAck.checked) throw new Error("Confirm passcode sequence completion before starting lock.");
    const recoveryAck = $("runnerRecoveryAck");
    if (!recoveryAck || !recoveryAck.checked) {
      throw new Error("Confirm that no recovery email/password was added before starting lock.");
    }

    const out = await api("/lock/start", {
      method: "POST",
      body: JSON.stringify({
        track: state.track,
        platform: state.platform,
        durationHours: durationToHours(state.durationValue, state.durationUnit),
        durationValue: state.durationValue,
        durationUnit: state.durationUnit,
        deviceName: state.deviceName,
        completionAttestation: true,
        sequenceId: state.selectedSequence.id
      })
    });
    state.selectedLockId = "";
    setMsg($("appMsg"), "Lock initiated.");
    await loadStatus();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

async function loadStatus() {
  if (!clerkClient || !clerkClient.user || !clerkClient.session) {
    await renderAuth();
    return;
  }
  try {
    try {
      const entitlement = await api("/billing/entitlement");
      state.billingEntitled = !!entitlement?.entitled;
      state.billingEnforcementEnabled = !!entitlement?.enforcementEnabled;
      state.billingSubscriptionStatus = String(entitlement?.subscriptionStatus || "inactive");
    } catch {
      state.billingEntitled = false;
      state.billingEnforcementEnabled = true;
      state.billingSubscriptionStatus = "unknown";
    }

    const out = await api("/lock/status");
    const sessions = Array.isArray(out.sessions) ? out.sessions : (out.id ? [out] : []);
    if (!sessions.length) {
      state.lock = null;
      state.locks = [];
      state.selectedLockId = "";
      stopCountdownTicker();
      renderDashboard();
      return;
    }
    state.lock = sessions[0];
    state.locks = sessions;
    if (state.phase === "locked" && state.selectedLockId && sessions.find((s) => s.id === state.selectedLockId)) {
      renderDeviceDetail();
      return;
    }
    renderDashboard();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

async function revealCode(lockSessionId) {
  try {
    const query = lockSessionId ? `?lockSessionId=${encodeURIComponent(lockSessionId)}` : "";
    const out = await api(`/passcode/reveal${query}`);
    state.revealedCode = out.code;
    state.revealedCodeById = out.lockSessionId;
    await loadStatus();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

async function deleteDevice(lockSessionId) {
  try {
    await api(`/lock/device/${encodeURIComponent(lockSessionId)}`, { method: "DELETE" });
    if (state.selectedLockId === lockSessionId) state.selectedLockId = "";
    state.revealedCode = "";
    state.revealedCodeById = "";
    setMsg($("appMsg"), "Device lock deleted.");
    await loadStatus();
  } catch (err) {
    setMsg($("appMsg"), err.message, true);
  }
}

function addAnotherDevice() {
  if (!canCreateDevice()) {
    setMsg($("appMsg"), "Start your 3-day trial first to add a new device.", true);
    renderDashboard();
    return;
  }
  stopCountdownTicker();
  state.selectedLockId = "";
  state.stepIndex = 0;
  state.passcodePrimerAccepted = false;
  state.steps = [];
  state.selectedSequence = null;
  state.runner = { index: 0, appleScreen: 1, typedCount: 0 };
  setMsg($("appMsg"), "Add the next device. A new passcode sequence will be generated.");
  renderConfig();
}

function backToHome() {
  stopCountdownTicker();
  state.selectedLockId = "";
  setMsg($("appMsg"), "");
  renderConfig();
}

async function renderAuth() {
  showAuth();
  stopCountdownTicker();
  state.lock = null;
  state.locks = [];
  state.selectedLockId = "";
  state.revealedCodeById = "";
  if (!clerkClient) return;
  const target = $("clerkAuth");
  target.innerHTML = `
    <div class="row auth-actions">
      <button id="clerkSignInBtn">Sign in</button>
      <button id="clerkSignUpBtn" class="ghost">Sign up</button>
    </div>
  `;
  $("clerkSignInBtn").onclick = () => clerkClient.redirectToSignIn({ signInForceRedirectUrl: window.location.origin });
  $("clerkSignUpBtn").onclick = () => clerkClient.redirectToSignUp({ signUpForceRedirectUrl: window.location.origin });
}

async function ensureSignedInForBilling() {
  if (clerkClient && clerkClient.user && clerkClient.session) return true;
  if (clerkClient) {
    await clerkClient.redirectToSignIn({ signInForceRedirectUrl: window.location.origin });
  }
  return false;
}

async function startPlan(plan = "monthly") {
  try {
    if (!(await ensureSignedInForBilling())) return;
    const out = await api("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        plan,
        successUrl: `${window.location.origin}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}?billing=cancel`
      })
    });
    if (!out.checkoutUrl) throw new Error("Checkout URL missing.");
    window.location.href = out.checkoutUrl;
  } catch (err) {
    setMsg($("authMsg"), err.message, true);
  }
}

async function handleBillingReturn() {
  const params = new URLSearchParams(window.location.search);
  const billing = String(params.get("billing") || "").trim().toLowerCase();
  if (!billing) return null;

  const clearParams = () => {
    params.delete("billing");
    params.delete("session_id");
    params.delete("checkout_session_id");
    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  };

  if (billing === "cancel") {
    clearParams();
    return { text: "Checkout canceled. Start your trial when you're ready.", isError: false };
  }

  if (billing !== "success") {
    clearParams();
    return null;
  }

  const sessionId = String(
    params.get("session_id") || params.get("checkout_session_id") || ""
  ).trim();
  try {
    await api("/billing/sync", {
      method: "POST",
      body: JSON.stringify({ checkoutSessionId: sessionId })
    });
    return { text: "Trial activated. You can now add a device.", isError: false };
  } catch (err) {
    return {
      text: err.message || "We could not sync billing yet. Refresh or open Manage Billing.",
      isError: true
    };
  } finally {
    clearParams();
  }
}

async function openBillingPortal() {
  try {
    if (!(await ensureSignedInForBilling())) return;
    const out = await api("/billing/portal", {
      method: "POST",
      body: JSON.stringify({ returnUrl: window.location.origin })
    });
    if (!out.portalUrl) throw new Error("Billing portal URL missing.");
    window.location.href = out.portalUrl;
  } catch (err) {
    setMsg($("authMsg"), err.message, true);
  }
}

async function manageAccount() {
  if (!(await ensureSignedInForBilling())) return;
  const tryFns = ["redirectToUserProfile", "openUserProfile"];
  for (const fn of tryFns) {
    if (typeof clerkClient?.[fn] === "function") {
      await clerkClient[fn]();
      return;
    }
  }
  const accountUrl = deriveClerkAccountUrl();
  if (accountUrl) {
    window.location.href = accountUrl;
    return;
  }
  setMsg($("appMsg"), "Unable to open Clerk account management.", true);
}

function deriveClerkAccountUrl() {
  const key = String(clerkPublishableKey || "").trim();
  if (!key) return "";
  const parts = key.split("_");
  const encoded = parts[parts.length - 1];
  if (!encoded) return "";
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(b64);
    const domain = decoded.replace(/\$+$/, "").trim();
    if (!domain) return "";
    return `https://${domain}/user`;
  } catch {
    return "";
  }
}

async function initClerk() {
  try {
    const config = await fetch("/auth/config").then((r) => r.json());
    clerkPublishableKey = String(config.publishableKey || "");
    if (!config.publishableKey) {
      throw new Error("Missing CLERK_PUBLISHABLE_KEY on server.");
    }

    await ensureClerkLoaded(config.publishableKey);
    if (!window.Clerk) throw new Error("Clerk script failed to load.");

    if (typeof window.Clerk === "function") {
      clerkClient = new window.Clerk(config.publishableKey);
      await clerkClient.load();
    } else {
      clerkClient = window.Clerk;
      await clerkClient.load({ publishableKey: config.publishableKey });
    }

    if (!clerkClient.user || !clerkClient.session) {
      await renderAuth();
      return;
    }
    showApp();
    const billingFlash = await handleBillingReturn();
    await loadStatus();
    if (billingFlash) {
      setMsg($("appMsg"), billingFlash.text, !!billingFlash.isError);
    }
  } catch (err) {
    setMsg($("authMsg"), err.message, true);
  }
}

$("logoutBtn").onclick = () => {
  logout();
};
$("manageBillingTopBtn").onclick = () => {
  openBillingPortal();
};
$("manageAccountTopBtn").onclick = () => {
  manageAccount();
};
$("topSignInBtn").onclick = async () => {
  if (!clerkClient) {
    setMsg($("authMsg"), "Auth is loading. Try again in a moment.", true);
    return;
  }
  await clerkClient.redirectToSignIn({ signInForceRedirectUrl: window.location.origin });
};
$("topSignUpBtn").onclick = async () => {
  if (!clerkClient) {
    setMsg($("authMsg"), "Auth is loading. Try again in a moment.", true);
    return;
  }
  await clerkClient.redirectToSignUp({ signUpForceRedirectUrl: window.location.origin });
};
const pricingMonthlyBtn = $("pricingMonthlyBtn");
if (pricingMonthlyBtn) pricingMonthlyBtn.onclick = () => startPlan("monthly");
const pricingYearlyBtn = $("pricingYearlyBtn");
if (pricingYearlyBtn) pricingYearlyBtn.onclick = () => startPlan("yearly");
const getStartedBtn = $("getStartedBtn");
if (getStartedBtn) {
  getStartedBtn.onclick = async () => {
    if (!clerkClient) {
      setMsg($("authMsg"), "Auth is loading. Try again in a moment.", true);
      return;
    }
    if (clerkClient.user && clerkClient.session) {
      showApp();
      await loadStatus();
      return;
    }
    await clerkClient.redirectToSignUp({ signUpForceRedirectUrl: window.location.origin });
  };
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
if ("caches" in window) {
  caches.keys().then((keys) => {
    keys
      .filter((key) => key.startsWith("scrrentime-"))
      .forEach((key) => caches.delete(key));
  });
}
initClerk();
