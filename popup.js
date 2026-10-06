// ==========================================================================
// Exam Guard - URL Trigger v2.2 Popup Script (popup.js)
// ==========================================================================

async function loadPopupData() {
  // 1. Get all recorded sessions
  const data = await chrome.storage.local.get({ examGuard_sessions: [] });
  let sessions = data.examGuard_sessions || [];

  // Proactively check all tabs for active Exam Guard sessions (GitHub Pages, Google Forms, etc.)
  try {
    const allTabs = await chrome.tabs.query({});
    for (const t of allTabs) {
      if (t.id && t.url && (t.url.includes("-ExamGuard") || t.url.includes("docs.google.com/forms") || t.url.includes("index.html"))) {
        try {
          const res = await chrome.tabs.sendMessage(t.id, { type: "GET_SESSION_STATUS" });
          if (res && res.session) {
            const s = res.session;
            const idx = sessions.findIndex(item => item.sessionId === s.sessionId);
            if (idx >= 0) {
              sessions[idx] = Object.assign({}, sessions[idx], s);
            } else {
              sessions.unshift(s);
            }
          }
        } catch (e) {}
      }
    }
    await chrome.storage.local.set({ examGuard_sessions: sessions });
  } catch (e) {}

  const total = sessions.length;
  const activeSessions = sessions.filter(s => s.status === "active");
  const terminatedSessions = sessions.filter(s => s.status === "terminated");

  // Update Stats
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-active").textContent = activeSessions.length;
  document.getElementById("stat-terminated").textContent = terminatedSessions.length;

  // Show Alert Box if any student exceeded violation limit
  const alertBox = document.getElementById("alert-box");
  const terminatedList = document.getElementById("terminated-list");

  if (terminatedSessions.length > 0) {
    alertBox.style.display = "block";
    terminatedList.innerHTML = terminatedSessions.map(s => `
      <li class="terminated-item">
        <div>
          <strong>${escapeHtml(s.studentName || "ผู้สอบ")}</strong> 
          <span style="color:#fca5a5;">(${escapeHtml(s.studentId || "-")})</span>
        </div>
        <div>
          <span style="color:#f87171; font-weight:700;">ละเมิด ${s.violations || 3}/${s.maxViolations || 3} ครั้ง</span>
        </div>
      </li>
    `).join("");
  } else {
    alertBox.style.display = "none";
  }

  // 2. Check current tab status
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const isGoogleForm = tab.url.includes("docs.google.com/forms");
      const isGoogleFormEdit = isGoogleForm && tab.url.includes("/edit");
      const isExamPortal = tab.url.includes("-ExamGuard") || (tab.url.includes("index.html") && tab.url.includes("form="));
      const gformBox = document.getElementById("gform-box");
      if (gformBox) {
        gformBox.style.display = isGoogleFormEdit ? "block" : "none";
      }

      chrome.runtime.sendMessage({ type: "CHECK_EXAM_URL", url: tab.url }, async res => {
        if (chrome.runtime.lastError) {
          return;
        }
        const tabStatus = document.getElementById("tab-status");
        const tabStudent = document.getElementById("tab-student");

        const isActuallyActive = (res && res.active) || isExamPortal;

        if (isActuallyActive) {
          tabStatus.textContent = "หน้าข้อสอบ (กำลังคุม)";
          tabStatus.className = "badge-status badge-active";

          // Try to get live session directly from tab first
          let currentSession = null;
          try {
            const tabRes = await chrome.tabs.sendMessage(tab.id, { type: "GET_SESSION_STATUS" });
            if (tabRes && tabRes.session) currentSession = tabRes.session;
          } catch (e) {}

          // Fallback to local storage lookup
          if (!currentSession) {
            const currentUrl = new URL(tab.url);
            const currentKey = `examGuard_active:${currentUrl.origin}${currentUrl.pathname}`;
            const keyData = await chrome.storage.local.get([currentKey]);
            const activeSessionId = keyData[currentKey];
            if (activeSessionId) {
              currentSession = sessions.find(s => s.sessionId === activeSessionId);
            } else {
              currentSession = sessions.find(s => s.status === "active") || sessions[0];
            }
          }

          if (currentSession) {
            if (currentSession.status === "terminated") {
              tabStatus.textContent = "🔴 ระงับการสอบแล้ว";
              tabStatus.className = "badge-status badge-danger";
            } else if (currentSession.status === "timeup") {
              tabStatus.textContent = "⌛ หมดเวลาสอบแล้ว";
              tabStatus.className = "badge-status badge-danger";
            }
            tabStudent.style.display = "block";
            tabStudent.innerHTML = `ผู้สอบ: <b>${escapeHtml(currentSession.studentName)}</b> (${escapeHtml(currentSession.studentId)}) • ละเมิด: <b>${currentSession.violations || 0}/${currentSession.maxViolations || 3}</b>`;

            const tabTimer = document.getElementById("tab-timer");
            if (tabTimer) {
              if (currentSession.enableTimer !== false) {
                const durationMs = (currentSession.durationMinutes || 60) * 60 * 1000;
                const remainingMs = Math.max(0, (currentSession.startTime + durationMs) - Date.now());
                const mins = Math.floor(remainingMs / 60000);
                const secs = Math.floor((remainingMs % 60000) / 1000);
                const pad = n => String(n).padStart(2, "0");
                tabTimer.style.display = "block";
                tabTimer.innerHTML = remainingMs > 0
                  ? `⏱️ เวลาที่เหลือ: ${pad(mins)}:${pad(secs)} นาที`
                  : `⌛ หมดเวลาทำข้อสอบแล้ว`;
              } else {
                tabTimer.style.display = "none";
              }
            }
          }
        } else {
          if (isGoogleFormEdit) {
            tabStatus.textContent = "หน้าสร้าง Google Form";
            tabStatus.className = "badge-status";
            tabStatus.style.background = "rgba(124, 58, 237, 0.25)";
            tabStatus.style.color = "#c4b5fd";
          } else {
            tabStatus.textContent = "ไม่ใช่หน้าข้อสอบ";
            tabStatus.className = "badge-status badge-inactive";
          }
          tabStudent.style.display = "none";
          const tabTimer = document.getElementById("tab-timer");
          if (tabTimer) tabTimer.style.display = "none";
        }
      });
    }
  } catch (e) {
    console.warn("Tab check warning:", e);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Event Listeners
document.getElementById("btn-open-gform-sidebar").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "OPEN_GFORM_SIDEBAR" });
      window.close();
    } catch (err) {
      // Content script isn't loaded on this tab yet (e.g. unrefreshed tab after extension reload)
      // Open dashboard cleanly instead of throwing unhandled rejection error
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?form=" + encodeURIComponent(tab.url || "")) });
      window.close();
    }
  }
};

document.getElementById("btn-open-dashboard").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const formUrl = tab ? tab.url : "";
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?form=" + encodeURIComponent(formUrl)) });
};

document.getElementById("btn-dashboard").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html#dashboard") });
};

document.getElementById("btn-settings").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html#settings") });
};

document.getElementById("link-refresh").onclick = e => {
  e.preventDefault();
  loadPopupData();
};

document.getElementById("link-reset").onclick = async e => {
  e.preventDefault();
  if (confirm("คุณต้องการล้างประวัติการสอบและรีเซ็ตสถิติทั้งหมดใช่หรือไม่?")) {
    await chrome.runtime.sendMessage({ type: "CLEAR_ALL_SESSIONS" });
    await loadPopupData();
    alert("ล้างประวัติการสอบเรียบร้อยแล้ว");
  }
};

// Initial load
loadPopupData();