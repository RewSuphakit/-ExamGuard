// ==========================================================================
// Exam Guard - URL Trigger v2.2 Service Worker (background.js)
// ==========================================================================

const DEFAULTS = {
  enabled: true,
  maxViolations: 3,
  proctorPin: "1234",
  requireStudentInfo: true,
  enableTimer: true,
  examDurationMinutes: 60,
  examPatterns: [
    "*docs.google.com/forms/*/viewform*",
    "*docs.google.com/forms/*/formResponse*",
    "*rewsuphakit.github.io/-ExamGuard/*",
    "*index.html*form=*",
    "https://your-exam.example.com/exam/*"
  ]
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  if (!current.examPatterns || current.examPatterns.length === 0) {
    current.examPatterns = DEFAULTS.examPatterns;
  } else {
    // Ensure Google Forms patterns exist in examPatterns
    if (!current.examPatterns.some(p => p.includes("docs.google.com/forms"))) {
      current.examPatterns.unshift("*docs.google.com/forms/*/viewform*");
    }
    if (!current.examPatterns.some(p => p.includes("-ExamGuard"))) {
      current.examPatterns.push("*rewsuphakit.github.io/-ExamGuard/*");
    }
  }
  if (!current.maxViolations) current.maxViolations = DEFAULTS.maxViolations;
  if (!current.proctorPin) current.proctorPin = DEFAULTS.proctorPin;
  if (current.requireStudentInfo === undefined) current.requireStudentInfo = DEFAULTS.requireStudentInfo;
  if (current.enableTimer === undefined) current.enableTimer = DEFAULTS.enableTimer;
  if (!current.examDurationMinutes) current.examDurationMinutes = DEFAULTS.examDurationMinutes;
  await chrome.storage.local.set(current);
  await updateBadge();
});

// Pattern matching function supporting glob *
function matchesPattern(url, pattern) {
  try {
    if (!pattern || !url) return false;
    const pat = pattern.trim();
    if (!pat) return false;

    const escapeRegex = s => s.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&");
    const regexPattern = pat.split("*").map(escapeRegex).join(".*");
    return new RegExp(regexPattern, "i").test(url);
  } catch {
    return false;
  }
}

async function isExamUrl(url) {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  if (!cfg.enabled || !url) return false;

  // Never lock teacher's form edit page
  if (url.includes("docs.google.com/forms") && url.includes("/edit")) {
    return false;
  }

  // Auto-protect Google Forms viewform/test pages
  if (url.includes("docs.google.com/forms") && (url.includes("/viewform") || url.includes("/formResponse"))) {
    return true;
  }

  // Auto-protect Exam Guard Web Portal (GitHub Pages or local portal)
  if (url.includes("-ExamGuard") || url.includes("exam-guard") || (url.includes("index.html") && url.includes("form="))) {
    return true;
  }

  return (cfg.examPatterns || []).some(p => matchesPattern(url, p.trim()));
}

// Update Extension Toolbar Badge
async function updateBadge() {
  try {
    const data = await chrome.storage.local.get({ examGuard_sessions: [] });
    const sessions = data.examGuard_sessions || [];
    const terminatedCount = sessions.filter(s => s.status === "terminated").length;
    const activeCount = sessions.filter(s => s.status === "active").length;

    if (terminatedCount > 0) {
      // Show Red Alert Badge if anyone exceeded violations
      await chrome.action.setBadgeText({ text: `${terminatedCount}` });
      await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      await chrome.action.setTitle({ title: `Exam Guard: มีผู้ละเมิดเกินกำหนด ${terminatedCount} คน!` });
    } else if (activeCount > 0) {
      await chrome.action.setBadgeText({ text: `${activeCount}` });
      await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
      await chrome.action.setTitle({ title: `Exam Guard: กำลังสอบ ${activeCount} คน` });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "Exam Guard" });
    }
  } catch (err) {
    console.error("Badge update error:", err);
  }
}

// Listen to Tab URL updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  const active = await isExamUrl(tab.url);
  const cfg = await chrome.storage.local.get(DEFAULTS);
  chrome.tabs.sendMessage(tabId, {
    type: "EXAM_URL_STATUS",
    active,
    config: {
      maxViolations: cfg.maxViolations,
      proctorPin: cfg.proctorPin,
      requireStudentInfo: cfg.requireStudentInfo,
      enableTimer: cfg.enableTimer,
      examDurationMinutes: cfg.examDurationMinutes
    }
  }).catch(() => {});
});

// Messaging Handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_EXAM_URL") {
    (async () => {
      const active = await isExamUrl(msg.url);
      const cfg = await chrome.storage.local.get(DEFAULTS);
      sendResponse({
        active,
        config: {
          maxViolations: cfg.maxViolations,
          proctorPin: cfg.proctorPin,
          requireStudentInfo: cfg.requireStudentInfo,
          enableTimer: cfg.enableTimer,
          examDurationMinutes: cfg.examDurationMinutes
        }
      });
    })();
    return true;
  }

  if (msg.type === "REGISTER_SESSION") {
    (async () => {
      const { session } = msg;
      if (!session) return sendResponse({ success: false });

      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      let sessions = data.examGuard_sessions || [];
      // Replace existing session with same ID or add new
      const idx = sessions.findIndex(s => s.sessionId === session.sessionId);
      if (idx >= 0) {
        sessions[idx] = Object.assign({}, sessions[idx], session);
      } else {
        sessions.unshift(session);
      }

      const toStore = { examGuard_sessions: sessions };

      // Set active session key for caller tab if available
      if (sender && sender.tab && sender.tab.url) {
        try {
          const u = new URL(sender.tab.url);
          toStore[`examGuard_active:${u.origin}${u.pathname}`] = session.sessionId;
        } catch (e) {}
      }

      await chrome.storage.local.set(toStore);
      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "RECORD_VIOLATION") {
    (async () => {
      const { sessionId, violationLog, violations, isTerminated, isTimeUp } = msg;
      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      let sessions = data.examGuard_sessions || [];
      const idx = sessions.findIndex(s => s.sessionId === sessionId);
      if (idx >= 0) {
        sessions[idx].violations = violations;
        sessions[idx].updatedAt = Date.now();
        if (violationLog) {
          if (!sessions[idx].logs) sessions[idx].logs = [];
          sessions[idx].logs.push(violationLog);
        }
        if (isTerminated) {
          sessions[idx].status = "terminated";
          sessions[idx].terminatedAt = Date.now();
        } else if (isTimeUp) {
          sessions[idx].status = "timeup";
          sessions[idx].terminatedAt = Date.now();
        }
        await chrome.storage.local.set({ examGuard_sessions: sessions });
      }
      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "GRANT_EXTRA_TIME") {
    (async () => {
      const { sessionId, extraMinutes } = msg;
      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      let sessions = data.examGuard_sessions || [];
      const idx = sessions.findIndex(s => s.sessionId === sessionId);
      if (idx >= 0) {
        sessions[idx].durationMinutes = (sessions[idx].durationMinutes || 60) + extraMinutes;
        sessions[idx].status = "active";
        sessions[idx].updatedAt = Date.now();
        if (!sessions[idx].logs) sessions[idx].logs = [];
        sessions[idx].logs.push({
          id: `log_${Date.now()}`,
          time: Date.now(),
          type: "timer",
          detail: `ผู้คุมสอบเพิ่มเวลาสอบให้เป็นกรณีพิเศษ ${extraMinutes} นาที`,
          violationNumber: 0
        });
        await chrome.storage.local.set({ examGuard_sessions: sessions });
      }
      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "UNLOCK_SESSION") {
    (async () => {
      const { sessionId } = msg;
      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      let sessions = data.examGuard_sessions || [];
      const idx = sessions.findIndex(s => s.sessionId === sessionId);
      if (idx >= 0) {
        sessions[idx].status = "active";
        sessions[idx].violations = 0;
        sessions[idx].updatedAt = Date.now();
        if (!sessions[idx].logs) sessions[idx].logs = [];
        sessions[idx].logs.push({
          id: `log_${Date.now()}`,
          time: Date.now(),
          type: "unlock",
          detail: "ผู้คุมสอบทำการปลดล็อกให้สอบต่อจากแดชบอร์ด",
          violationNumber: 0
        });
        await chrome.storage.local.set({ examGuard_sessions: sessions });
      }

      // Also reset state in matching examGuard:* storage key
      const all = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("examGuard:") && v && typeof v === "object" && v.sessionId === sessionId) {
          v.status = "active";
          v.violations = 0;
          await chrome.storage.local.set({ [k]: v });
        }
      }

      // Broadcast to tabs to unlock active screen in realtime
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: "EXAM_GUARD_UNLOCKED", sessionId }).catch(() => {});
          }
        }
      } catch (e) {}

      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "GET_ALL_SESSIONS") {
    (async () => {
      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      sendResponse({ sessions: data.examGuard_sessions || [] });
    })();
    return true;
  }

  if (msg.type === "CLEAR_ALL_SESSIONS") {
    (async () => {
      await chrome.storage.local.set({ examGuard_sessions: [] });
      // Also clear all examGuard: or session keys
      const all = await chrome.storage.local.get(null);
      const delKeys = Object.keys(all).filter(k => k.startsWith("examGuard:") || k.startsWith("examGuard_active:"));
      if (delKeys.length > 0) {
        await chrome.storage.local.remove(delKeys);
      }

      // Broadcast to tabs
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: "EXAM_GUARD_SESSION_DELETED", all: true }).catch(() => {});
          }
        }
      } catch (e) {}

      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "DELETE_SESSION") {
    (async () => {
      const { sessionId } = msg;
      const data = await chrome.storage.local.get({ examGuard_sessions: [] });
      let sessions = (data.examGuard_sessions || []).filter(s => s.sessionId !== sessionId);
      await chrome.storage.local.set({ examGuard_sessions: sessions });

      // Clean up matching active session keys
      const all = await chrome.storage.local.get(null);
      const delKeys = [];
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("examGuard_active:") && v === sessionId) {
          delKeys.push(k);
        }
        if (k.startsWith("examGuard:") && v && typeof v === "object" && v.sessionId === sessionId) {
          delKeys.push(k);
        }
      }
      if (delKeys.length > 0) {
        await chrome.storage.local.remove(delKeys);
      }

      // Broadcast to tabs
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: "EXAM_GUARD_SESSION_DELETED", sessionId }).catch(() => {});
          }
        }
      } catch (e) {}

      await updateBadge();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.type === "OPEN_TAB") {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ success: true });
    return true;
  }
});