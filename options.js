// ==========================================================================
// Exam Guard - URL Trigger v2.2 Options & Dashboard (options.js)
// ==========================================================================

let allSessions = [];
let activeTab = "dashboard";

// Tab Switching
function switchTab(tab) {
  activeTab = tab;
  const btnDash = document.getElementById("tab-btn-dashboard");
  const btnSet = document.getElementById("tab-btn-settings");
  const paneDash = document.getElementById("pane-dashboard");
  const paneSet = document.getElementById("pane-settings");

  if (tab === "dashboard") {
    btnDash.classList.add("active");
    btnSet.classList.remove("active");
    paneDash.classList.add("active");
    paneSet.classList.remove("active");
    loadDashboardData();
  } else {
    btnSet.classList.add("active");
    btnDash.classList.remove("active");
    paneSet.classList.add("active");
    paneDash.classList.remove("active");
    loadSettingsData();
  }
}

document.getElementById("tab-btn-dashboard").onclick = () => switchTab("dashboard");
document.getElementById("tab-btn-settings").onclick = () => switchTab("settings");

// Check hash on load
if (location.hash === "#settings") {
  switchTab("settings");
} else {
  switchTab("dashboard");
}

// Helper: Format Date/Time
function formatDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.toLocaleDateString("th-TH")} ${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatTimeOnly(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

// ==========================================================================
// 1. DASHBOARD DATA & TABLE
// ==========================================================================
async function loadDashboardData() {
  const data = await chrome.storage.local.get({ examGuard_sessions: [] });
  allSessions = data.examGuard_sessions || [];

  updateMetrics();
  renderTable();
}

function updateMetrics() {
  const total = allSessions.length;
  const active = allSessions.filter(s => s.status === "active").length;
  const warned = allSessions.filter(s => (s.violations || 0) > 0 && s.status !== "terminated").length;
  const terminated = allSessions.filter(s => s.status === "terminated").length;

  document.getElementById("metric-total").textContent = total;
  document.getElementById("metric-active").textContent = active;
  document.getElementById("metric-warned").textContent = warned;
  document.getElementById("metric-terminated").textContent = terminated;
}

function renderTable() {
  const tbody = document.getElementById("examinees-table-body");
  const empty = document.getElementById("table-empty");
  const search = document.getElementById("search-input").value.trim().toLowerCase();
  const filter = document.getElementById("status-filter").value;

  const filtered = allSessions.filter(s => {
    // Search match
    const nameMatch = (s.studentName || "").toLowerCase().includes(search);
    const idMatch = (s.studentId || "").toLowerCase().includes(search);
    const seatMatch = (s.seatNumber || "").toLowerCase().includes(search);
    const urlMatch = (s.url || "").toLowerCase().includes(search);
    const matchesSearch = !search || nameMatch || idMatch || seatMatch || urlMatch;

    // Status filter
    let matchesStatus = true;
    if (filter === "terminated") {
      matchesStatus = s.status === "terminated";
    } else if (filter === "timeup") {
      matchesStatus = s.status === "timeup";
    } else if (filter === "warned") {
      matchesStatus = (s.violations || 0) > 0 && s.status !== "terminated" && s.status !== "timeup";
    } else if (filter === "active") {
      matchesStatus = s.status === "active";
    }

    return matchesSearch && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = filtered.map(s => {
    const isTerminated = s.status === "terminated";
    const isTimeUp = s.status === "timeup";
    const violationsCount = s.violations || 0;
    const max = s.maxViolations || 3;
    const lastLog = (s.logs && s.logs.length > 0) ? s.logs[s.logs.length - 1] : null;

    let statusBadge = "";
    if (isTerminated) {
      statusBadge = `<span class="badge badge-term">🔴 ระเมิดเกินกำหนด</span>`;
    } else if (isTimeUp) {
      statusBadge = `<span class="badge badge-warn" style="border-color:#d97706; background:rgba(245,158,11,0.15); color:#fbbf24;">⌛ หมดเวลาสอบ</span>`;
    } else if (violationsCount > 0) {
      statusBadge = `<span class="badge badge-warn">🟡 เตือน ${violationsCount}/${max}</span>`;
    } else {
      statusBadge = `<span class="badge badge-ok">🟢 ปกติ</span>`;
    }

    const rowClass = isTerminated ? "row-terminated" : "";
    const violationDisplay = isTerminated
      ? `<strong style="color: #ef4444;">${violationsCount} / ${max}</strong>`
      : `${violationsCount} / ${max}`;

    return `
      <tr class="${rowClass}">
        <td>
          <div style="font-weight: 600;">${formatDateTime(s.startTime)}</div>
          ${isTerminated ? `<div style="color: #f87171; font-size: 11px;">ระงับเมื่อ: ${formatTimeOnly(s.terminatedAt)}</div>` : ''}
        </td>
        <td><strong style="color: #93c5fd; font-family: monospace; font-size: 14px;">${escapeHtml(s.studentId || "-")}</strong></td>
        <td>
          <div style="font-weight: 700; font-size: 14px; color: #fff;">${escapeHtml(s.studentName || "นิรนาม")}</div>
          <div style="color: #64748b; font-size: 11px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(s.url || '')}">${escapeHtml(s.title || s.url || '')}</div>
        </td>
        <td>${escapeHtml(s.seatNumber || "-")}</td>
        <td>${violationDisplay}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="max-width: 220px; font-size: 12px; color: #cbd5e1;">
            ${lastLog ? escapeHtml(lastLog.detail) : '<span style="color:#64748b;">ไม่มีประวัติการละเมิด</span>'}
          </div>
        </td>
        <td style="text-align: right;">
          <div class="action-btn-group" style="justify-content: flex-end;">
            <button class="btn-xs" onclick="openDetailModal('${s.sessionId}')">🔍 ดูประวัติ</button>
            ${isTerminated ? `<button class="btn-xs btn-xs-unlock" onclick="unlockStudentSession('${s.sessionId}')">🔓 ปลดล็อก</button>` : ''}
            <button class="btn-xs" style="color: #f87171;" onclick="deleteStudentSession('${s.sessionId}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// Search and filter listeners
document.getElementById("search-input").addEventListener("input", renderTable);
document.getElementById("status-filter").addEventListener("change", renderTable);
document.getElementById("btn-refresh").onclick = loadDashboardData;

// Modal Detail View
window.openDetailModal = function(sessionId) {
  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  const modal = document.getElementById("modal-detail");
  const modalContent = document.getElementById("modal-content");
  const isTerminated = session.status === "terminated";

  const logs = session.logs || [];
  let logsHtml = "";

  if (logs.length === 0) {
    logsHtml = `<div style="text-align: center; color: #94a3b8; padding: 20px;">ไม่พบประวัติการทำผิดกฎ (ปฏิบัติตามกฎอย่างถูกต้อง)</div>`;
  } else {
    logsHtml = `
      <div style="margin-top: 14px;">
        <h4 style="margin: 0 0 10px; font-size: 13px; color: #cbd5e1; text-transform: uppercase;">
          ลำดับเหตุการณ์การละเมิด (${logs.length} ครั้ง)
        </h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${logs.map(l => `
            <div style="display: flex; gap: 12px; background: #0b1324; padding: 10px 14px; border-radius: 10px; border-left: 3px solid ${l.type === 'unlock' ? '#10b981' : '#ef4444'};">
              <div style="font-weight: 700; color: #94a3b8; font-family: monospace; font-size: 12px; white-space: nowrap;">
                ${formatTimeOnly(l.time)}
              </div>
              <div style="flex: 1;">
                <div style="font-weight: 600; color: #f8fafc; font-size: 13px;">${escapeHtml(l.detail)}</div>
                <div style="font-size: 11px; color: #64748b;">ประเภท: ${escapeHtml(l.type)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  modalContent.innerHTML = `
    <div style="background: #18243b; padding: 14px 18px; border-radius: 12px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-size: 16px; font-weight: 800; color: #60a5fa;">
          ${escapeHtml(session.studentName)} (${escapeHtml(session.studentId)})
        </div>
        <div>
          ${isTerminated ? '<span class="badge badge-term">🔴 ระเมิดเกินกำหนด (ตัดสิทธิ์)</span>' : (session.status === 'timeup' ? '<span class="badge badge-warn" style="border-color:#d97706; background:rgba(245,158,11,0.15); color:#fbbf24;">⌛ หมดเวลาสอบ</span>' : '<span class="badge badge-ok">🟢 กำลังสอบ</span>')}
        </div>
      </div>
      <div style="font-size: 12px; color: #94a3b8; line-height: 1.6;">
        <div>ห้อง/ที่นั่ง: <b style="color: #cbd5e1;">${escapeHtml(session.seatNumber || '-')}</b></div>
        <div>ระยะเวลาสอบ: <b style="color: #cbd5e1;">${session.durationMinutes || 60} นาที</b></div>
        <div>URL ข้อสอบ: <b style="color: #cbd5e1;">${escapeHtml(session.url || '-')}</b></div>
        <div>เวลาเริ่มสอบ: <b style="color: #cbd5e1;">${formatDateTime(session.startTime)}</b></div>
        ${isTerminated ? `<div>เวลาที่ถูกระงับสิทธิ์: <b style="color: #f87171;">${formatDateTime(session.terminatedAt)}</b></div>` : ''}
        ${session.status === 'timeup' ? `<div>เวลาที่หมดเวลา: <b style="color: #fbbf24;">${formatDateTime(session.terminatedAt)}</b></div>` : ''}
      </div>
    </div>
    ${logsHtml}
  `;

  modal.style.display = "flex";
};

document.getElementById("modal-close").onclick = () => {
  document.getElementById("modal-detail").style.display = "none";
};
document.getElementById("modal-btn-close").onclick = () => {
  document.getElementById("modal-detail").style.display = "none";
};
document.getElementById("modal-detail").onclick = e => {
  if (e.target.id === "modal-detail") {
    document.getElementById("modal-detail").style.display = "none";
  }
};

// Unlock Student Session
window.unlockStudentSession = async function(sessionId) {
  if (confirm("ต้องการปลดล็อกให้นักเรียนคนนี้กลับมาทำข้อสอบต่อใช่หรือไม่? (จำนวนครั้งการละเมิดจะถูกรีเซ็ต)")) {
    await chrome.runtime.sendMessage({ type: "UNLOCK_SESSION", sessionId });
    await loadDashboardData();
  }
};

// Delete Single Session
window.deleteStudentSession = async function(sessionId) {
  if (confirm("ต้องการลบประวัติของผู้สอบคนนี้ใช่หรือไม่?")) {
    await chrome.runtime.sendMessage({ type: "DELETE_SESSION", sessionId });
    await loadDashboardData();
  }
};

// Clear All Sessions
document.getElementById("btn-clear-all").onclick = async () => {
  if (confirm("คำเตือน: คุณต้องการลบประวัติการสอบของผู้เข้าสอบทุกคนใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้")) {
    await chrome.runtime.sendMessage({ type: "CLEAR_ALL_SESSIONS" });
    await loadDashboardData();
  }
};

// Export to CSV
document.getElementById("btn-export").onclick = () => {
  if (allSessions.length === 0) {
    alert("ยังไม่มีข้อมูลสำหรับส่งออกรายงาน");
    return;
  }

  const headers = ["รหัสนักศึกษา", "ชื่อ-นามสกุล", "ห้อง/ที่นั่ง", "URLข้อสอบ", "เวลาเริ่มสอบ", "เวลาสิ้นสุด", "จำนวนครั้งที่ละเมิด", "สถานะ", "ประวัติการละเมิดทั้งหมด"];
  const rows = allSessions.map(s => {
    const isTerminated = s.status === "terminated";
    const statusText = isTerminated ? "ระเมิดเกินกำหนด (ตัดสิทธิ์)" : (s.violations > 0 ? "มีการเตือน" : "ปกติ");
    const logsText = (s.logs || []).map(l => `[${formatTimeOnly(l.time)}] ${l.detail}`).join(" | ");

    return [
      `"${(s.studentId || '').replace(/"/g, '""')}"`,
      `"${(s.studentName || '').replace(/"/g, '""')}"`,
      `"${(s.seatNumber || '').replace(/"/g, '""')}"`,
      `"${(s.url || '').replace(/"/g, '""')}"`,
      `"${formatDateTime(s.startTime)}"`,
      `"${s.terminatedAt ? formatDateTime(s.terminatedAt) : '-'}"`,
      `"${s.violations || 0}/${s.maxViolations || 3}"`,
      `"${statusText}"`,
      `"${logsText.replace(/"/g, '""')}"`
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ExamGuard_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ==========================================================================
// 2. SETTINGS DATA
// ==========================================================================
async function loadSettingsData() {
  const cfg = await chrome.storage.local.get({
    examPatterns: ["https://your-exam.example.com/exam/*"],
    maxViolations: 3,
    proctorPin: "1234",
    requireStudentInfo: true,
    enableTimer: true,
    examDurationMinutes: 60
  });

  document.getElementById("setting-patterns").value = (cfg.examPatterns || []).join("\n");
  document.getElementById("setting-max").value = cfg.maxViolations || 3;
  document.getElementById("setting-pin").value = cfg.proctorPin || "1234";
  document.getElementById("setting-req-info").checked = cfg.requireStudentInfo ?? true;
  document.getElementById("setting-enable-timer").checked = cfg.enableTimer ?? true;
  document.getElementById("setting-duration").value = cfg.examDurationMinutes || 60;
}

document.getElementById("btn-save-settings").onclick = async () => {
  const patternsText = document.getElementById("setting-patterns").value;
  const patterns = patternsText.split("\n").map(x => x.trim()).filter(Boolean);
  const max = Math.max(1, Math.min(20, Number(document.getElementById("setting-max").value) || 3));
  const pin = document.getElementById("setting-pin").value.trim() || "1234";
  const reqInfo = document.getElementById("setting-req-info").checked;
  const enableTimer = document.getElementById("setting-enable-timer").checked;
  const duration = Math.max(1, Math.min(360, Number(document.getElementById("setting-duration").value) || 60));

  await chrome.storage.local.set({
    examPatterns: patterns,
    maxViolations: max,
    proctorPin: pin,
    requireStudentInfo: reqInfo,
    enableTimer,
    examDurationMinutes: duration
  });

  const msg = document.getElementById("save-msg");
  msg.style.color = "#34d399";
  msg.textContent = "✓ บันทึกการตั้งค่าเรียบร้อยแล้ว";
  setTimeout(() => {
    msg.textContent = "";
  }, 3000);
};