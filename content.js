// ==========================================================================
// Exam Guard - URL Trigger v2.3 Content Script (content.js)
// ==========================================================================

(() => {
  // Prevent duplicate execution or running on chrome-extension internal pages
  if (window.__examGuardInjected) return;
  if (location.protocol === "chrome-extension:") return;
  window.__examGuardInjected = true;

  // ==========================================================================
  // WEBPAGE HANDSHAKE (ส่งสัญญาณให้หน้าเว็บข้อสอบรู้ว่ามีส่วนขยายติดตั้งอยู่)
  // ==========================================================================
  try {
    document.documentElement.setAttribute("data-exam-guard-installed", "true");
    document.documentElement.setAttribute("data-exam-guard-version", "2.3.0");
    window.dispatchEvent(new CustomEvent("EXAM_GUARD_HANDSHAKE", { detail: { version: "2.3.0", installed: true } }));
    window.postMessage({ type: "EXAM_GUARD_HANDSHAKE", version: "2.3.0", installed: true }, "*");
  } catch (e) { }

  let active = false;
  let started = false;
  let isTerminated = false;
  let isTimeUp = false;
  let violations = 0;

  // Global Chrome Runtime Message Listener for All Tabs/Frames
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === "GET_SESSION_STATUS" || req.action === "GET_SESSION_STATUS") {
      // 1. If content.js itself has active sessionData
      if (sessionData) {
        sendResponse({ session: sessionData });
        return true;
      }
      // 2. If running on Exam Guard Web page, read from localStorage
      try {
        const raw = localStorage.getItem(`eg_web_${location.origin}${location.pathname}`);
        if (raw) {
          const webSession = JSON.parse(raw);
          sendResponse({
            session: {
              sessionId: `web_${webSession.studentId}_${webSession.startTime}`,
              studentName: webSession.studentName,
              studentId: webSession.studentId,
              seatNumber: webSession.seatNumber,
              startTime: webSession.startTime,
              violations: webSession.violations || 0,
              maxViolations: maxViolations,
              durationMinutes: webSession.durationMinutes || 60,
              status: webSession.status || "active",
              enableTimer: true,
              examTitle: document.title,
              logs: webSession.logs || []
            }
          });
          return true;
        }
      } catch (e) {}

      sendResponse({ session: null });
      return true;
    }

    if (req.action === "OPEN_GFORM_SIDEBAR") {
      if (typeof openGoogleFormsSidebar === "function") {
        openGoogleFormsSidebar();
        sendResponse({ success: true });
      }
      return true;
    }

    if (req.type === "EXAM_URL_STATUS" && req.active) {
      active = true;
      document.documentElement.setAttribute("data-exam-guard-active", "true");
      window.postMessage({ type: "EXAM_GUARD_STATUS_UPDATE", active: true, version: "2.3.0" }, "*");
      if (req.config) {
        maxViolations = req.config.maxViolations || maxViolations;
        proctorPin = req.config.proctorPin || proctorPin;
        requireStudentInfo = req.config.requireStudentInfo ?? requireStudentInfo;
        enableTimer = req.config.enableTimer ?? enableTimer;
        examDurationMinutes = req.config.examDurationMinutes || examDurationMinutes;
      }
      if (!started && !isTerminated && !isTimeUp) {
        initSessionOrShowGate();
      }
      sendResponse({ success: true });
      return true;
    }
  });

  // Listen for Ping and Web Portal events
  window.addEventListener("message", event => {
    if (!event.data) return;

    if (event.data.type === "EXAM_GUARD_PING") {
      window.postMessage({
        type: "EXAM_GUARD_PONG",
        version: "2.3.0",
        installed: true,
        active,
        session: sessionData ? {
          studentName: sessionData.studentName,
          studentId: sessionData.studentId,
          status: sessionData.status,
          violations: sessionData.violations
        } : null
      }, "*");
    }

    // Bridge messages from standalone exam-guard-web.js into Chrome extension
    if (event.data.source === "EXAM_GUARD_WEB") {
      if (event.data.type === "REGISTER_SESSION") {
        chrome.runtime.sendMessage({
          type: "REGISTER_SESSION",
          session: event.data.data
        }).catch(() => {});
      }
      if (event.data.type === "RECORD_VIOLATION") {
        chrome.runtime.sendMessage({
          type: "RECORD_VIOLATION",
          ...event.data.data
        }).catch(() => {});
      }
    }
  });

  // Enforce Anti-Copy & Anti-Selection inside Google Forms (viewform / formResponse)
  if (location.hostname.includes("docs.google.com") && location.pathname.includes("/forms/") && !location.pathname.includes("/edit")) {
    const preventAction = e => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if ((tag === "input" || tag === "textarea") && (e.type === "selectstart" || e.type === "keydown")) {
        return; // Allow entering text in text answers
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.clipboardData) e.clipboardData.setData("text/plain", "");
      return false;
    };

    window.addEventListener("selectstart", preventAction, true);
    document.addEventListener("selectstart", preventAction, true);
    window.addEventListener("copy", preventAction, true);
    document.addEventListener("copy", preventAction, true);
    window.addEventListener("cut", preventAction, true);
    document.addEventListener("cut", preventAction, true);
    window.addEventListener("contextmenu", preventAction, true);
    document.addEventListener("contextmenu", preventAction, true);
    window.addEventListener("dragstart", preventAction, true);
    document.addEventListener("dragstart", preventAction, true);

    window.addEventListener("mouseup", () => {
      try {
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) {
          sel.removeAllRanges();
        }
      } catch (e) {}
    }, true);

    function injectAntiSelectStyles() {
      const id = "eg-google-form-no-select";
      if (document.getElementById(id)) return;
      const st = document.createElement("style");
      st.id = id;
      st.textContent = `
        html, body, div, span, p, label, form, table, tbody, tr, td, h1, h2, h3, h4, [role="heading"], [role="radio"], [role="checkbox"] {
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
        }
        input, textarea, [contenteditable="true"] {
          -webkit-user-select: text !important;
          user-select: text !important;
        }
        ::selection {
          background: transparent !important;
          color: inherit !important;
        }
        ::-moz-selection {
          background: transparent !important;
          color: inherit !important;
        }
      `;
      (document.head || document.documentElement).appendChild(st);
    }

    injectAntiSelectStyles();
    document.addEventListener("DOMContentLoaded", injectAntiSelectStyles);
    window.addEventListener("load", injectAntiSelectStyles);
    setInterval(injectAntiSelectStyles, 2000);
  }
  let maxViolations = 3;
  let proctorPin = "1234";
  let requireStudentInfo = true;
  let enableTimer = true;
  let examDurationMinutes = 60;
  let sessionData = null;

  let timerInterval = null;
  let timerWidget = null;
  let warned15Min = false;
  let warned5Min = false;
  let warned1Min = false;

  let watermarkElement = null;
  let watermarkOverlay = null;
  let lockoutGateObserver = null;

  // Granular cooldown timestamps to prevent rapid violation triggers
  let lastCopyViolationTime = 0;
  let lastKeyboardViolationTime = 0;
  let lastRightClickViolationTime = 0;
  let lastTabViolationTime = 0;
  let lastBlurViolationTime = 0;

  const currentUrlKey = () => `examGuard_active:${location.origin}${location.pathname}`;

  // Helper: Format Date/Time
  function formatTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDateTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return `${d.toLocaleDateString("th-TH")} ${d.toLocaleTimeString("th-TH")}`;
  }

  // Toast Notification
  function showToast(title, message, type = "normal") {
    let t = document.getElementById("eg-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "eg-toast";
      (document.body || document.documentElement).appendChild(t);
    }
    t.className = type === "danger" ? "eg-toast-danger" : (type === "warning" ? "eg-toast-warning" : "");
    t.innerHTML = `<b>${title}</b><span>${message}</span>`;
    t.style.display = "block";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      if (t) t.style.display = "none";
    }, type === "danger" ? 4200 : 3000);
  }

  // Check if current URL is configured as an exam URL
  function checkExamUrl() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "CHECK_EXAM_URL", url: location.href }, res => {
        if (chrome.runtime.lastError || !res) {
          resolve({ active: false });
        } else {
          resolve(res);
        }
      });
    });
  }

  // ==========================================================================
  // 1. START GATE (ลงทะเบียนก่อนเริ่มสอบ)
  // ==========================================================================
  function showStartGate() {
    if (document.getElementById("eg-start-gate") || document.getElementById("eg-lockout-gate") || document.getElementById("eg-timeup-gate")) return;

    const el = document.createElement("div");
    el.id = "eg-start-gate";
    el.innerHTML = `
      <div class="eg-card">
        <div class="eg-logo">🛡️</div>
        <h1>Exam Guard Pro</h1>
        <p class="eg-sub">ตรวจพบหน้าทำข้อสอบที่ได้รับการคุ้มครองความปลอดภัย</p>

        <div class="eg-form-group">
          <label>ชื่อ - นามสกุล ผู้สอบ <span class="eg-req">*</span></label>
          <input type="text" id="eg-student-name" placeholder="เช่น นายสมชาย ใจดี" autocomplete="off" />
          <div class="eg-form-error" id="eg-err-name">กรุณาระบุชื่อ-นามสกุลของผู้สอบ</div>
        </div>

        <div class="eg-form-row">
          <div class="eg-form-group" style="flex: 1.3;">
            <label>รหัสนักศึกษา / เลขประจำตัว <span class="eg-req">*</span></label>
            <input type="text" id="eg-student-id" placeholder="เช่น 64010582" autocomplete="off" />
            <div class="eg-form-error" id="eg-err-id">กรุณาระบุรหัสนักศึกษา</div>
          </div>
          <div class="eg-form-group" style="flex: 0.9;">
            <label>ห้องสอบ / ที่นั่ง</label>
            <input type="text" id="eg-student-seat" placeholder="เช่น Lab 3 / B-04" autocomplete="off" />
          </div>
        </div>

        <div class="eg-list">
          ${enableTimer ? `<div><span class="icon">⏱️</span> <strong>จำกัดเวลาทำข้อสอบ:</strong> ${examDurationMinutes} นาที (นับถอยหลัง)</div>` : ''}
          <div><span class="icon">✓</span> ป้องกันการคัดลอก ตัด และวางข้อความ</div>
          <div><span class="icon">✓</span> ตรวจจับการสลับแท็บ ย่อหน้าต่าง และออกจากหน้าจอสอบ</div>
          <div><span class="icon">✓</span> ตรวจจับการออกจากโหมดเต็มหน้าจอ (Fullscreen)</div>
          <div><span class="icon">✓</span> แสดง Watermark ระบุตัวตนผู้สอบป้องกันการถ่ายรูป</div>
          <div><span class="icon">⛔</span> <strong>ระงับการสอบทันที</strong> หากทำผิดกฎครบ ${maxViolations} ครั้ง</div>
        </div>

        <button id="eg-start">เริ่มทำข้อสอบ</button>
        <small>เมื่อกดเริ่ม ระบบจะเริ่มจับเวลาและบันทึกสถิติการสอบส่งไปยังผู้คุมสอบ</small>
      </div>
    `;

    (document.body || document.documentElement).appendChild(el);

    const btnStart = document.getElementById("eg-start");
    btnStart.onclick = handleStartClick;
  }

  function removeStartGate() {
    document.getElementById("eg-start-gate")?.remove();
  }

  async function handleStartClick() {
    const inputName = document.getElementById("eg-student-name");
    const inputId = document.getElementById("eg-student-id");
    const inputSeat = document.getElementById("eg-student-seat");
    const errName = document.getElementById("eg-err-name");
    const errId = document.getElementById("eg-err-id");

    const studentName = inputName?.value.trim() || "";
    const studentId = inputId?.value.trim() || "";
    const seatNumber = inputSeat?.value.trim() || "";

    let hasError = false;
    if (requireStudentInfo) {
      if (!studentName) {
        if (errName) errName.style.display = "block";
        hasError = true;
      } else {
        if (errName) errName.style.display = "none";
      }

      if (!studentId) {
        if (errId) errId.style.display = "block";
        hasError = true;
      } else {
        if (errId) errId.style.display = "none";
      }
    }

    if (hasError) return;

    // Create unique session
    const sessionId = `eg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    sessionData = {
      sessionId,
      studentName: studentName || "ผู้เข้าสอบนิรนาม",
      studentId: studentId || "N/A",
      seatNumber: seatNumber || "-",
      url: location.href,
      title: document.title || location.pathname,
      startTime: Date.now(),
      updatedAt: Date.now(),
      violations: 0,
      maxViolations,
      enableTimer,
      durationMinutes: examDurationMinutes,
      status: "active",
      terminatedAt: null,
      logs: []
    };

    // Save session in local storage
    const key = currentUrlKey();
    await chrome.storage.local.set({ [key]: sessionId });

    // Inform background
    chrome.runtime.sendMessage({
      type: "REGISTER_SESSION",
      session: sessionData
    });

    startExam();
  }

  async function startExam() {
    started = true;
    active = true;
    isTerminated = false;
    isTimeUp = false;
    violations = sessionData?.violations || 0;

    removeStartGate();

    // Prevent text selection by applying CSS class
    document.body?.classList.add("eg-no-select");

    // Try requesting fullscreen
    try {
      await document.documentElement.requestFullscreen?.();
    } catch (e) {
      console.warn("Fullscreen request ignored or blocked:", e);
    }

    setupWatermarks();

    // Start Exam Timer Countdown if enabled
    if (sessionData?.enableTimer) {
      initExamTimer();
    }

    showToast("🛡️ Exam Guard", `เริ่มโหมดป้องกันแล้ว: ${sessionData?.studentName} (${sessionData?.studentId})`, "normal");
  }

  // ==========================================================================
  // 2. EXAM TIMER SYSTEM (ระบบนับเวลาถอยหลังการสอบ)
  // ==========================================================================
  function initExamTimer() {
    if (timerInterval) clearInterval(timerInterval);

    // Create or find floating timer widget
    if (!timerWidget) {
      timerWidget = document.createElement("div");
      timerWidget.id = "eg-timer-widget";
      timerWidget.innerHTML = `
        <span class="eg-timer-icon">⏱️</span>
        <span class="eg-timer-label">เวลาที่เหลือ:</span>
        <span id="eg-timer-clock">--:--</span>
      `;
      (document.body || document.documentElement).appendChild(timerWidget);
    }

    function tick() {
      if (!started || isTerminated || isTimeUp || !sessionData) return;

      const durationMs = (sessionData.durationMinutes || 60) * 60 * 1000;
      const endTime = sessionData.startTime + durationMs;
      const remainingMs = endTime - Date.now();

      if (remainingMs <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        triggerTimeUp(sessionData);
        return;
      }

      // Format remaining time
      const totalSec = Math.floor(remainingMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      const pad = n => String(n).padStart(2, "0");
      let timeString = "";
      if (hours > 0) {
        timeString = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
      } else {
        timeString = `${pad(mins)}:${pad(secs)}`;
      }

      const clockEl = document.getElementById("eg-timer-clock");
      if (clockEl) clockEl.textContent = timeString;

      // Visual warning classes & toast notifications
      if (remainingMs <= 5 * 60 * 1000) {
        // Less than 5 mins
        timerWidget?.classList.add("eg-timer-critical");
        timerWidget?.classList.remove("eg-timer-warning");
        if (!warned5Min) {
          warned5Min = true;
          showToast("⚠️ ใกล้หมดเวลาสอบ", "เหลือเวลาทำข้อสอบอีก 5 นาที กรุณาตรวจสอบคำตอบ", "warning");
        }
      } else if (remainingMs <= 15 * 60 * 1000) {
        // Less than 15 mins
        timerWidget?.classList.add("eg-timer-warning");
        timerWidget?.classList.remove("eg-timer-critical");
        if (!warned15Min) {
          warned15Min = true;
          showToast("⏱️ แจ้งเตือนเวลาสอบ", "เหลือเวลาทำข้อสอบอีก 15 นาที", "warning");
        }
      } else {
        timerWidget?.classList.remove("eg-timer-warning", "eg-timer-critical");
      }

      if (remainingMs <= 60 * 1000 && !warned1Min) {
        warned1Min = true;
        showToast("🚨 เหลือเวลาอีก 1 นาที", "ระบบจะปิดรับคำตอบอัตโนมัติเมื่อหมดเวลา", "danger");
      }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function triggerTimeUp(session) {
    isTimeUp = true;
    started = false;

    // Remove timer widget
    if (timerWidget) {
      timerWidget.remove();
      timerWidget = null;
    }

    if (session) {
      session.status = "timeup";
      session.terminatedAt = Date.now();
    }

    // Inform background
    chrome.runtime.sendMessage({
      type: "RECORD_VIOLATION",
      sessionId: session?.sessionId,
      violations,
      isTimeUp: true
    });

    // Lock page
    document.body?.classList.add("eg-body-locked");
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch { }
    }
    try { document.activeElement?.blur?.(); } catch { }

    showTimeUpGate(session);
  }

  function showTimeUpGate(session) {
    let gate = document.getElementById("eg-timeup-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "eg-timeup-gate";
      (document.body || document.documentElement).appendChild(gate);
    }

    const studentName = session?.studentName || "ผู้เข้าสอบ";
    const studentId = session?.studentId || "-";
    const seatNumber = session?.seatNumber || "-";
    const duration = session?.durationMinutes || examDurationMinutes || 60;

    gate.innerHTML = `
      <div class="eg-card eg-timeup-card">
        <div class="eg-timeup-badge">⌛ TIME'S UP • หมดเวลาการสอบ</div>
        <h1 class="eg-timeup-title">หมดเวลาทำข้อสอบแล้ว</h1>
        <p class="eg-sub" style="color: #fde68a;">
          ครบกำหนดระยะเวลาการทำข้อสอบที่ตั้งไว้ (${duration} นาที)
        </p>

        <div class="eg-student-banner">
          <div class="eg-sb-row">
            <span class="eg-sb-label">ผู้เข้าสอบ:</span>
            <span class="eg-sb-val" style="color: #60a5fa; font-size: 15px;">${escapeHtml(studentName)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">รหัสประจำตัว:</span>
            <span class="eg-sb-val">${escapeHtml(studentId)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">ห้องสอบ / ที่นั่ง:</span>
            <span class="eg-sb-val">${escapeHtml(seatNumber)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">จำนวนการละเมิดระหว่างสอบ:</span>
            <span class="eg-sb-val" style="color: ${violations > 0 ? '#fbbf24' : '#34d399'};">${violations}/${maxViolations} ครั้ง</span>
          </div>
        </div>

        <div class="eg-timeup-box">
          ⌛ <strong>คำแนะนำ:</strong> การสอบสิ้นสุดลงแล้ว ระบบได้ปิดกั้นการแก้ไขคำตอบเรียบร้อยแล้ว กรุณาวางมือและปฏิบัติตามคำแนะนำของอาจารย์ผู้คุมสอบ
        </div>

        <!-- กล่องสำหรับอาจารย์เพิ่มเวลาพิเศษ -->
        <div style="margin-top: 20px; border-top: 1px solid #334155; padding-top: 16px;">
          <small style="color: #94a3b8; display: block; margin-bottom: 8px;">
            สำหรับอาจารย์/ผู้คุมสอบ (เพิ่มเวลาสอบกรณีฉุกเฉิน):
          </small>
          <div class="eg-unlock-row">
            <input type="password" id="eg-timeup-pin" class="eg-unlock-input" placeholder="กรอกรหัส PIN ผู้คุมสอบ" />
            <select id="eg-extra-mins" style="background:#0f172a; color:#fff; border:1px solid #475569; border-radius:10px; padding:0 8px; font-size:13px;">
              <option value="5">+5 นาที</option>
              <option value="10">+10 นาที</option>
              <option value="15">+15 นาที</option>
            </select>
            <button id="eg-btn-grant-time" class="eg-btn-unlock" style="background:#d97706; color:#fff;">⏱️ เพิ่มเวลา</button>
          </div>
          <div id="eg-timeup-msg" style="font-size: 12px; margin-top: 6px; display: none;"></div>
        </div>
      </div>
    `;

    document.getElementById("eg-btn-grant-time").onclick = handleGrantExtraTime;
  }

  async function handleGrantExtraTime() {
    const inputPin = document.getElementById("eg-timeup-pin");
    const extraSelect = document.getElementById("eg-extra-mins");
    const msg = document.getElementById("eg-timeup-msg");
    const enteredPin = inputPin?.value.trim() || "";
    const extraMinutes = Number(extraSelect?.value) || 5;

    if (enteredPin === proctorPin) {
      if (msg) {
        msg.style.color = "#4ade80";
        msg.textContent = `✓ รหัสถูกต้อง เพิ่มเวลาสอบให้ ${extraMinutes} นาที...`;
        msg.style.display = "block";
      }

      // Resume exam
      isTimeUp = false;
      started = true;
      if (sessionData) {
        sessionData.durationMinutes = (sessionData.durationMinutes || 60) + extraMinutes;
        sessionData.status = "active";
      }

      // Inform background
      chrome.runtime.sendMessage({
        type: "GRANT_EXTRA_TIME",
        sessionId: sessionData?.sessionId,
        extraMinutes
      });

      document.body?.classList.remove("eg-body-locked");
      document.getElementById("eg-timeup-gate")?.remove();

      // Reset warnings & restart timer
      warned15Min = false;
      warned5Min = false;
      warned1Min = false;
      initExamTimer();

      showToast("⏱️ ผู้คุมสอบเพิ่มเวลาสอบ", `เพิ่มเวลาให้ ${extraMinutes} นาที สามารถทำข้อสอบต่อได้`, "normal");
    } else {
      if (msg) {
        msg.style.color = "#f87171";
        msg.textContent = "รหัส PIN ผู้คุมสอบไม่ถูกต้อง!";
        msg.style.display = "block";
      }
      if (inputPin) inputPin.value = "";
    }
  }

  // ==========================================================================
  // 3. WATERMARK SYSTEM
  // ==========================================================================
  function setupWatermarks() {
    if (!watermarkElement) {
      watermarkElement = document.createElement("div");
      watermarkElement.id = "eg-watermark";
      const name = sessionData?.studentName || "ผู้เข้าสอบ";
      const id = sessionData?.studentId || "";
      watermarkElement.textContent = `🛡️ EXAM GUARD • ${id ? id + ' • ' : ''}${name} • ${new Date().toLocaleTimeString('th-TH')}`;
      (document.body || document.documentElement).appendChild(watermarkElement);
    }

    if (!watermarkOverlay && sessionData) {
      watermarkOverlay = document.createElement("div");
      watermarkOverlay.className = "eg-watermark-overlay";
      const text = `${sessionData.studentId} ${sessionData.studentName}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
        <text x="20" y="80" fill="gray" font-size="14" font-family="Arial" transform="rotate(-20 20,80)">${text}</text>
      </svg>`;
      const encodedSvg = encodeURIComponent(svg);
      watermarkOverlay.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodedSvg}")`;
      (document.body || document.documentElement).appendChild(watermarkOverlay);
    }
  }

  // ==========================================================================
  // 4. VIOLATION TRACKING & AUDIT LOGGING (พร้อมระบบป้องกันนับซ้ำซ้อน)
  // ==========================================================================
  function addViolation(type, detail) {
    if (!started || isTerminated || isTimeUp) return;

    const now = Date.now();
    violations++;

    const violationLog = {
      id: `log_${now}`,
      time: now,
      type,
      detail,
      violationNumber: violations
    };

    if (sessionData) {
      sessionData.violations = violations;
      if (!sessionData.logs) sessionData.logs = [];
      sessionData.logs.push(violationLog);
      sessionData.updatedAt = now;
    }

    // Check if violation limit reached
    if (violations >= maxViolations) {
      isTerminated = true;
      started = false;
      if (sessionData) {
        sessionData.status = "terminated";
        sessionData.terminatedAt = now;
      }

      // Stop timer widget
      if (timerWidget) timerWidget.remove();
      if (timerInterval) clearInterval(timerInterval);

      chrome.runtime.sendMessage({
        type: "RECORD_VIOLATION",
        sessionId: sessionData?.sessionId,
        violationLog,
        violations,
        isTerminated: true
      });

      terminateExam(sessionData, detail);
    } else {
      // Send progress to background
      chrome.runtime.sendMessage({
        type: "RECORD_VIOLATION",
        sessionId: sessionData?.sessionId,
        violationLog,
        violations,
        isTerminated: false
      });

      showToast("⚠️ ตรวจพบการละเมิดกฎ", `${detail} (ครั้งที่ ${violations}/${maxViolations})`, "danger");
    }
  }

  // ==========================================================================
  // 5. EXAM TERMINATION & LOCKDOWN OVERLAY (เมื่อทำผิดกฎครบกำหนด)
  // ==========================================================================
  function terminateExam(session, reason) {
    isTerminated = true;
    started = false;

    removeStartGate();
    if (timerWidget) timerWidget.remove();
    if (timerInterval) clearInterval(timerInterval);

    document.body?.classList.add("eg-body-locked");
    document.documentElement?.classList.add("eg-terminated");

    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch { }
    }

    try { document.activeElement?.blur?.(); } catch { }

    showLockoutGate(session, reason);
  }

  function showLockoutGate(session, currentReason) {
    let gate = document.getElementById("eg-lockout-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "eg-lockout-gate";
      (document.body || document.documentElement).appendChild(gate);
    }

    const studentName = session?.studentName || "ไม่ระบุชื่อ";
    const studentId = session?.studentId || "ไม่ระบุรหัส";
    const seatNumber = session?.seatNumber || "-";
    const logs = session?.logs || [];
    const count = session?.violations || violations || maxViolations;
    const termTime = session?.terminatedAt || Date.now();

    let timelineHtml = "";
    if (logs.length > 0) {
      timelineHtml = logs.map(l => `
        <div class="eg-vt-item">
          <div class="eg-vt-num">${l.violationNumber || "!"}</div>
          <div class="eg-vt-info">
            <div class="eg-vt-reason">${escapeHtml(l.detail)}</div>
            <div class="eg-vt-time">${formatTime(l.time)}</div>
          </div>
        </div>
      `).join("");
    } else {
      timelineHtml = `
        <div class="eg-vt-item">
          <div class="eg-vt-num">!</div>
          <div class="eg-vt-info">
            <div class="eg-vt-reason">${escapeHtml(currentReason || "ละเมิดกฎการสอบเกินจำนวนที่กำหนด")}</div>
            <div class="eg-vt-time">${formatTime(Date.now())}</div>
          </div>
        </div>
      `;
    }

    gate.innerHTML = `
      <div class="eg-card eg-lockout-card">
        <div class="eg-lockout-badge">⛔ EXAM TERMINATED • สิ้นสุดสิทธิ์การสอบ</div>
        <h1 class="eg-lockout-title">การสอบถูกระงับสิทธิ์ทันที</h1>
        <p class="eg-sub" style="color: #fca5a5;">
          ตรวจพบการทำผิดกฎการสอบครบจำนวนที่กำหนด (${count}/${maxViolations} ครั้ง)
        </p>

        <div class="eg-student-banner">
          <div class="eg-sb-row">
            <span class="eg-sb-label">ผู้เข้าสอบ:</span>
            <span class="eg-sb-val" style="color: #60a5fa; font-size: 15px;">${escapeHtml(studentName)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">รหัสประจำตัว:</span>
            <span class="eg-sb-val">${escapeHtml(studentId)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">ห้องสอบ / ที่นั่ง:</span>
            <span class="eg-sb-val">${escapeHtml(seatNumber)}</span>
          </div>
          <div class="eg-sb-row">
            <span class="eg-sb-label">เวลาที่ถูกระงับ:</span>
            <span class="eg-sb-val" style="color: #f87171;">${formatDateTime(termTime)}</span>
          </div>
        </div>

        <div class="eg-violation-timeline">
          <div class="eg-vt-title">
            <span>บันทึกประวัติการละเมิด</span>
            <span>${count} ครั้ง</span>
          </div>
          ${timelineHtml}
        </div>

        <div class="eg-warning-box">
          ⚠️ <strong>คำสั่ง:</strong> คุณถูกตัดสิทธิ์การทำข้อสอบในครั้งนี้เรียบร้อยแล้ว ระบบได้ส่งรายงานประวัติการละเมิดให้ผู้คุมสอบแล้ว กรุณานั่งรออยู่กับที่และติดต่ออาจารย์ผู้คุมสอบในห้อง
        </div>

        <div style="margin-top: 20px; border-top: 1px solid #334155; padding-top: 16px;">
          <small style="color: #94a3b8; display: block; margin-bottom: 8px;">
            สำหรับอาจารย์/ผู้คุมสอบเท่านั้น (กรอก PIN เพื่อปลดล็อก):
          </small>
          <div class="eg-unlock-row">
            <input type="password" id="eg-proctor-pin" class="eg-unlock-input" placeholder="กรอกรหัส PIN ผู้คุมสอบ" />
            <button id="eg-btn-unlock" class="eg-btn-unlock">🔓 ปลดล็อกการสอบ</button>
          </div>
          <div id="eg-unlock-msg" style="color: #f87171; font-size: 12px; margin-top: 6px; display: none;"></div>
        </div>
      </div>
    `;

    document.getElementById("eg-btn-unlock").onclick = handleProctorUnlock;
    watchLockoutGatePersistence();
  }

  function watchLockoutGatePersistence() {
    if (lockoutGateObserver) return;
    lockoutGateObserver = new MutationObserver(() => {
      if (isTerminated && !document.getElementById("eg-lockout-gate")) {
        showLockoutGate(sessionData);
      }
    });
    lockoutGateObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: false
    });
  }

  async function handleProctorUnlock() {
    const inputPin = document.getElementById("eg-proctor-pin");
    const msg = document.getElementById("eg-unlock-msg");
    const entered = inputPin?.value.trim() || "";

    if (entered === proctorPin) {
      if (msg) {
        msg.style.color = "#4ade80";
        msg.textContent = "✓ รหัสถูกต้อง กำลังปลดล็อกให้ทำข้อสอบต่อ...";
        msg.style.display = "block";
      }

      isTerminated = false;
      started = true;
      violations = 0;
      if (sessionData) {
        sessionData.status = "active";
        sessionData.violations = 0;
      }

      if (lockoutGateObserver) {
        lockoutGateObserver.disconnect();
        lockoutGateObserver = null;
      }

      chrome.runtime.sendMessage({
        type: "UNLOCK_SESSION",
        sessionId: sessionData?.sessionId
      });

      document.body?.classList.remove("eg-body-locked");
      document.documentElement?.classList.remove("eg-terminated");
      document.getElementById("eg-lockout-gate")?.remove();

      // Restart timer if enabled
      if (sessionData?.enableTimer) {
        initExamTimer();
      }

      showToast("🔓 ผู้คุมสอบปลดล็อกแล้ว", "สามารถทำข้อสอบต่อได้ รีเซ็ตจำนวนครั้งแล้ว", "normal");
    } else {
      if (msg) {
        msg.style.color = "#f87171";
        msg.textContent = "รหัส PIN ผู้คุมสอบไม่ถูกต้อง!";
        msg.style.display = "block";
      }
      if (inputPin) inputPin.value = "";
    }
  }

  // Real-time Proctor remote unlock & delete listener
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "EXAM_GUARD_UNLOCKED") {
      if (sessionData && msg.sessionId === sessionData.sessionId) {
        isTerminated = false;
        started = true;
        violations = 0;
        sessionData.status = "active";
        sessionData.violations = 0;
        if (lockoutGateObserver) {
          lockoutGateObserver.disconnect();
          lockoutGateObserver = null;
        }
        document.body?.classList.remove("eg-body-locked");
        document.documentElement?.classList.remove("eg-terminated");
        document.getElementById("eg-lockout-gate")?.remove();
        if (sessionData?.enableTimer) {
          initExamTimer();
        }
        showToast("🔓 ผู้คุมสอบปลดล็อกแล้ว", "อาจารย์ปลดล็อกให้จากแดชบอร์ด สามารถทำข้อสอบต่อได้ทันที", "normal");
      }
    } else if (msg.type === "EXAM_GUARD_SESSION_DELETED") {
      if (msg.all || (sessionData && msg.sessionId === sessionData.sessionId)) {
        isTerminated = false;
        violations = 0;
        if (lockoutGateObserver) {
          lockoutGateObserver.disconnect();
          lockoutGateObserver = null;
        }
        document.body?.classList.remove("eg-body-locked");
        document.documentElement?.classList.remove("eg-terminated");
        document.getElementById("eg-lockout-gate")?.remove();
        showToast("ℹ️ รีเซ็ตสถานะการสอบ", "บันทึกการสอบถูกลบออกจากระบบแล้ว", "normal");
      }
    }
  });

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
  // 6. EVENT LISTENERS FOR ANTI-CHEAT (แก้ไขปัญหานับคัดลอกเร็วเกินไป)
  // ==========================================================================

  // 1) Text Selection: บล็อกการลากคลุมข้อความ แต่ "ไม่นับเป็นความผิด" เพื่อป้องกันเผลอลากแล้วโดนตัดสิทธิ์ทันที
  document.addEventListener("selectstart", e => {
    if (!started || isTerminated || isTimeUp) return;
    e.preventDefault();
  }, true);

  // 2) Clipboard Copy & Cut: มี Cooldown 2.5 วินาที และไม่นับซ้ำกับคีย์ลัด Ctrl+C
  document.addEventListener("copy", e => {
    if (!started || isTerminated || isTimeUp) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    // ถ้าเพิ่งกด Ctrl+C ไปภายใน 2.5 วินาที ไม่ต้องนับซ้ำ
    if (now - lastCopyViolationTime < 2500) return;
    lastCopyViolationTime = now;

    addViolation("copy", "พยายามคัดลอกข้อความ (Clipboard Copy)");
  }, true);

  document.addEventListener("cut", e => {
    if (!started || isTerminated || isTimeUp) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastCopyViolationTime < 2500) return;
    lastCopyViolationTime = now;

    addViolation("copy", "พยายามตัดข้อความ (Clipboard Cut)");
  }, true);

  // 3) Context Menu: คลิกขวา มี Cooldown 2.5 วินาที
  document.addEventListener("contextmenu", e => {
    if (!started || isTerminated || isTimeUp) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastRightClickViolationTime < 2500) return;
    lastRightClickViolationTime = now;

    addViolation("contextmenu", "พยายามคลิกขวา (Context Menu)");
  }, true);

  // 4) Keyboard Shortcuts: ป้องกัน e.repeat และแยกหมวดหมู่พร้อม Cooldown
  document.addEventListener("keydown", e => {
    if (isTerminated || isTimeUp) {
      if (e.target && (e.target.id === "eg-proctor-pin" || e.target.id === "eg-timeup-pin")) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!started) return;

    // ถ้ากดค้างไว้ (key repeat) ให้ละเว้น ไม่นับเบิ้ล
    if (e.repeat) return;

    const k = e.key.toLowerCase();
    const now = Date.now();

    // คีย์ลัดคัดลอก/ตัด: Ctrl+C หรือ Ctrl+X
    if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "x")) {
      e.preventDefault();
      e.stopPropagation();
      if (now - lastCopyViolationTime < 2500) return;
      lastCopyViolationTime = now;
      addViolation("copy", `กดคีย์ลัดพยายามคัดลอก/ตัด: ${e.ctrlKey ? 'Ctrl+' : 'Cmd+'}${e.key.toUpperCase()}`);
      return;
    }

    // คีย์ลัดต้องห้ามอื่นๆ: Ctrl+A, S, P, V, U
    if ((e.ctrlKey || e.metaKey) && ["a", "s", "p", "v", "u"].includes(k)) {
      e.preventDefault();
      e.stopPropagation();
      if (now - lastKeyboardViolationTime < 2000) return;
      lastKeyboardViolationTime = now;
      addViolation("keyboard", `กดคีย์ลัดต้องห้าม: ${e.ctrlKey ? 'Ctrl+' : 'Cmd+'}${e.key.toUpperCase()}`);
      return;
    }

    // Print Screen
    if (e.key === "PrintScreen") {
      if (now - lastKeyboardViolationTime < 2000) return;
      lastKeyboardViolationTime = now;
      addViolation("screenshot", "ตรวจพบการกดปุ่ม Print Screen แคปหน้าจอ");
      return;
    }

    // DevTools: F12 หรือ Ctrl+Shift+I/J/C
    if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k))) {
      e.preventDefault();
      e.stopPropagation();
      if (now - lastKeyboardViolationTime < 2000) return;
      lastKeyboardViolationTime = now;
      addViolation("devtools", "พยายามเปิด Developer Tools (ตรวจสอบโค้ด)");
      return;
    }

    // Alt+Tab
    if (e.altKey && e.key === "Tab") {
      if (now - lastKeyboardViolationTime < 2000) return;
      lastKeyboardViolationTime = now;
      addViolation("tab", "ตรวจพบการกด Alt+Tab สลับหน้าต่าง");
      return;
    }
  }, true);

  // 5) Tab Switching / Window Blur: มี Cooldown 2.0 วินาที
  document.addEventListener("visibilitychange", () => {
    if (started && !isTerminated && !isTimeUp && document.hidden) {
      const now = Date.now();
      if (now - lastTabViolationTime < 2000) return;
      lastTabViolationTime = now;
      addViolation("tab", "สลับแท็บ ย่อเบราว์เซอร์ หรือเปิดโปรแกรมอื่น");
    }
  });

  window.addEventListener("blur", () => {
    if (started && !isTerminated && !isTimeUp) {
      const now = Date.now();
      // ถ้าเพิ่งเกิดเหตุการณ์ tab switch ไป ไม่ต้องนับซ้ำกับ blur
      if (now - lastTabViolationTime < 1500) return;
      if (now - lastBlurViolationTime < 2000) return;
      lastBlurViolationTime = now;
      addViolation("blur", "คลิกออกนอกหน้าต่างสอบ");
    }
  });

  // 6) Fullscreen Exit
  document.addEventListener("fullscreenchange", () => {
    if (started && !isTerminated && !isTimeUp && !document.fullscreenElement) {
      addViolation("fullscreen", "ออกจากโหมดเต็มหน้าจอ (Fullscreen)");
    }
  });

  window.addEventListener("beforeunload", e => {
    if (started && !isTerminated && !isTimeUp) {
      e.preventDefault();
      e.returnValue = "การสอบกำลังดำเนินอยู่ หากออกจากหน้านี้ระบบจะบันทึกประวัติการละเมิด";
    }
  });

  // Message receiver
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "EXAM_URL_STATUS" && msg.active) {
      active = true;
      document.documentElement.setAttribute("data-exam-guard-active", "true");
      window.postMessage({ type: "EXAM_GUARD_STATUS_UPDATE", active: true, version: "2.3.0" }, "*");
      if (msg.config) {
        maxViolations = msg.config.maxViolations || maxViolations;
        proctorPin = msg.config.proctorPin || proctorPin;
        requireStudentInfo = msg.config.requireStudentInfo ?? requireStudentInfo;
        enableTimer = msg.config.enableTimer ?? enableTimer;
        examDurationMinutes = msg.config.examDurationMinutes || examDurationMinutes;
      }
      if (!started && !isTerminated && !isTimeUp) {
        initSessionOrShowGate();
      }
    }
  });

  // ==========================================================================
  // 7. INITIALIZATION & SESSION RESTORATION
  // ==========================================================================
  async function initSessionOrShowGate() {
    const key = currentUrlKey();
    const stored = await chrome.storage.local.get([key, "examGuard_sessions"]);
    const activeSessionId = stored[key];
    const sessions = stored.examGuard_sessions || [];

    if (activeSessionId) {
      const existing = sessions.find(s => s.sessionId === activeSessionId);
      if (existing) {
        sessionData = existing;
        violations = existing.violations || 0;

        // Check if terminated
        if (existing.status === "terminated" || violations >= maxViolations) {
          terminateExam(existing, "ตรวจพบสถานะถูกระงับสิทธิ์การสอบจากการทำผิดกฎก่อนหน้านี้");
          return;
        }

        // Check if time is up
        if (existing.status === "timeup") {
          triggerTimeUp(existing);
          return;
        }

        // Check if time expired while page was away
        if (existing.enableTimer) {
          const durationMs = (existing.durationMinutes || 60) * 60 * 1000;
          if (Date.now() >= existing.startTime + durationMs) {
            triggerTimeUp(existing);
            return;
          }
        }

        // If session was active, resume it
        if (existing.status === "active") {
          started = true;
          active = true;
          document.body?.classList.add("eg-no-select");
          setupWatermarks();
          if (existing.enableTimer) initExamTimer();
          showToast("🛡️ ดำเนินการสอบต่อ", `ผู้สอบ: ${existing.studentName} (ละเมิด ${violations}/${maxViolations})`, "normal");
          return;
        }
      }
    }

    showStartGate();
  }

  // Self-check on load
  checkExamUrl().then(res => {
    if (res && res.active) {
      active = true;
      document.documentElement.setAttribute("data-exam-guard-active", "true");
      window.postMessage({ type: "EXAM_GUARD_STATUS_UPDATE", active: true, version: "2.3.0" }, "*");
      if (res.config) {
        maxViolations = res.config.maxViolations || maxViolations;
        proctorPin = res.config.proctorPin || proctorPin;
        requireStudentInfo = res.config.requireStudentInfo ?? requireStudentInfo;
        enableTimer = res.config.enableTimer ?? enableTimer;
        examDurationMinutes = res.config.examDurationMinutes || examDurationMinutes;
      }
      initSessionOrShowGate();
    }
  });

  // ==========================================================================
  // GOOGLE FORMS EDITOR INTEGRATION (EXTENDED FORM IN-PAGE SIDEBAR)
  // ==========================================================================
  function initGoogleFormsEditorIntegration() {
    if (!location.hostname.includes("docs.google.com") || !location.pathname.includes("/forms/")) return;

    // Listen for message from popup
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === "OPEN_GFORM_SIDEBAR") {
        openGoogleFormsSidebar();
        sendResponse({ success: true });
      }
    });

    // Create floating badge on Google Forms page
    function createTriggerBadge() {
      if (document.getElementById("eg-gform-badge")) return;
      const badge = document.createElement("div");
      badge.id = "eg-gform-badge";
      badge.innerHTML = `<span style="font-size:15px;">🛡️</span><span>Exam Guard</span>`;
      badge.title = "คลิกเพื่อเปิดแผงควบคุม Extended Form (ตั้งเวลา & ควบคุมการทุจริต)";
      badge.style.cssText = `
        position: fixed !important;
        top: 14px !important;
        right: 120px !important;
        background: #673ab7 !important;
        color: #ffffff !important;
        padding: 6px 14px !important;
        border-radius: 999px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 0 4px 15px rgba(103, 58, 183, 0.45) !important;
        z-index: 2147483640 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        user-select: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        transition: transform 0.15s, background 0.15s !important;
      `;
      badge.onmouseover = () => { badge.style.transform = "scale(1.04)"; badge.style.background = "#5e35b1"; };
      badge.onmouseout = () => { badge.style.transform = "scale(1)"; badge.style.background = "#673ab7"; };
      badge.onclick = () => openGoogleFormsSidebar();
      (document.body || document.documentElement).appendChild(badge);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createTriggerBadge);
    } else {
      createTriggerBadge();
    }
    setInterval(createTriggerBadge, 2000);
  }

  function openGoogleFormsSidebar() {
    let sidebar = document.getElementById("eg-gform-sidebar");
    if (sidebar) {
      sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
      return;
    }

    sidebar = document.createElement("div");
    sidebar.id = "eg-gform-sidebar";
    sidebar.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 330px !important;
      height: 100vh !important;
      background: #ffffff !important;
      box-shadow: -4px 0 25px rgba(0,0,0,0.2) !important;
      z-index: 2147483646 !important;
      display: flex !important;
      flex-direction: column !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Google Sans", sans-serif !important;
      color: #202124 !important;
      box-sizing: border-box !important;
      font-size: 13px !important;
    `;

    sidebar.innerHTML = `
      <style>
        #eg-gform-sidebar * { box-sizing: border-box; }
        .eg-gf-header { background: #673ab7; color: #fff; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
        .eg-gf-user { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #f1f3f4; color: #3c4043; font-size: 13px; }
        .eg-gf-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
        .eg-gf-item { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #f1f3f4; }
        .eg-gf-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .eg-gf-title { font-weight: 600; color: #202124; display: flex; align-items: center; gap: 6px; }
        .eg-gf-switch { position: relative; display: inline-block; width: 38px; height: 20px; }
        .eg-gf-switch input { opacity: 0; width: 0; height: 0; }
        .eg-gf-slider { position: absolute; cursor: pointer; inset: 0; background-color: #dadce0; transition: .2s; border-radius: 20px; }
        .eg-gf-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .2s; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .eg-gf-switch input:checked + .eg-gf-slider { background-color: #673ab7; }
        .eg-gf-switch input:checked + .eg-gf-slider:before { transform: translateX(18px); }
        .eg-gf-input { width: 65px; padding: 5px 8px; border-radius: 6px; border: 1px solid #dadce0; font-size: 13px; text-align: center; }
        .eg-gf-footer { border-top: 1px solid #dadce0; padding: 12px 14px; background: #fafafa; display: flex; flex-direction: column; gap: 8px; }
        .eg-gf-btn-main { width: 100%; background: #673ab7; color: #fff; border: 0; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; }
        .eg-gf-btn-main:hover { background: #5e35b1; }
        .eg-gf-links { display: flex; justify-content: space-around; font-size: 12px; }
        .eg-gf-link { color: #673ab7; cursor: pointer; text-decoration: none; font-weight: 600; }
        .eg-gf-link:hover { text-decoration: underline; }
      </style>

      <div class="eg-gf-header">
        <span>EXTENDED FORM (EXAM GUARD)</span>
        <span id="eg-gf-close" style="cursor:pointer; font-size:16px;">✕</span>
      </div>

      <div class="eg-gf-user">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:24px; height:24px; border-radius:50%; background:#e8eaed; display:flex; align-items:center; justify-content:center;">👤</div>
          <span>exam.proctor@gmail.com</span>
        </div>
      </div>

      <div class="eg-gf-body">
        <div style="font-size:11px; font-weight:700; color:#5f6368; margin-bottom:8px; text-transform:uppercase;">Share Form</div>
        <div style="display:flex; gap:8px; margin-bottom:14px;">
          <select id="eg-gf-mode" style="flex:1; padding:6px 10px; border-radius:6px; border:1px solid #dadce0; font-size:13px;">
            <option value="anonymous">Link (Anonymous)</option>
            <option value="restricted">Link (Require Student ID)</option>
          </select>
        </div>

        <!-- 1. Time Limit -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">⏱️ Time Limit</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-timer" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
            <input type="number" id="eg-gf-val-timer" class="eg-gf-input" value="60" min="1" max="300">
            <span style="font-size:12px; color:#5f6368;">minutes</span>
          </div>
        </div>

        <!-- 2. Restrict Attempts -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">🚨 Restrict Attempts</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-viol" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
            <input type="number" id="eg-gf-val-viol" class="eg-gf-input" value="3" min="1" max="10">
            <span style="font-size:12px; color:#5f6368;">strikes allowed</span>
          </div>
        </div>

        <!-- 3. Auto-Submit after timer ends -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">⛔ Auto-Submit on Time Up</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-auto" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>

        <!-- 4. Camera Snapshots -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">📷 Camera Snapshots</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-cam" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>

        <!-- 5. Tab Switch Detection -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">📑 Tab Switch Detection</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-tab" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>

        <!-- 6. Block Copy & Paste -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">📋 Block Copy & Paste</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-copy" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>

        <!-- 7. Force Fullscreen -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">🔲 Force Fullscreen</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-fs" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>

        <!-- 8. Student Watermark -->
        <div class="eg-gf-item">
          <div class="eg-gf-row">
            <span class="eg-gf-title">🌊 Student Watermark</span>
            <label class="eg-gf-switch">
              <input type="checkbox" id="eg-gf-chk-wm" checked>
              <span class="eg-gf-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="eg-gf-footer">
        <button type="button" class="eg-gf-btn-main" id="eg-gf-btn-copy">
          🔗 คัดลอกลิงก์ส่งให้นักเรียน
        </button>
        <div class="eg-gf-links">
          <span class="eg-gf-link" id="eg-gf-btn-preview">👁️ Preview</span>
          <span class="eg-gf-link" id="eg-gf-btn-dash">🌐 Full Dashboard</span>
        </div>
      </div>
    `;

    document.body.appendChild(sidebar);

    // Persistent configuration management
    function getSidebarConfig() {
      return {
        timerOn: document.getElementById("eg-gf-chk-timer")?.checked ?? true,
        duration: document.getElementById("eg-gf-val-timer")?.value || "60",
        violOn: document.getElementById("eg-gf-chk-viol")?.checked ?? true,
        maxViol: document.getElementById("eg-gf-val-viol")?.value || "3",
        autoOn: document.getElementById("eg-gf-chk-auto")?.checked ?? true,
        camOn: document.getElementById("eg-gf-chk-cam")?.checked ?? false,
        tabOn: document.getElementById("eg-gf-chk-tab")?.checked ?? true,
        copyOn: document.getElementById("eg-gf-chk-copy")?.checked ?? true,
        fsOn: document.getElementById("eg-gf-chk-fs")?.checked ?? true,
        wmOn: document.getElementById("eg-gf-chk-wm")?.checked ?? true,
        mode: document.getElementById("eg-gf-mode")?.value || "anonymous"
      };
    }

    function saveSidebarConfig() {
      const cfg = getSidebarConfig();
      try {
        localStorage.setItem("eg_gform_sidebar_settings", JSON.stringify(cfg));
      } catch (e) {}

      // Sync with Chrome Extension storage
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          enableTimer: cfg.timerOn,
          examDurationMinutes: parseInt(cfg.duration, 10) || 60,
          maxViolations: cfg.violOn ? (parseInt(cfg.maxViol, 10) || 3) : 99,
          requireStudentInfo: cfg.mode === "restricted"
        }).catch(() => {});
      }
    }

    function restoreSidebarConfig() {
      try {
        const raw = localStorage.getItem("eg_gform_sidebar_settings");
        if (!raw) return;
        const cfg = JSON.parse(raw);
        if (document.getElementById("eg-gf-chk-timer") && cfg.timerOn !== undefined) document.getElementById("eg-gf-chk-timer").checked = cfg.timerOn;
        if (document.getElementById("eg-gf-val-timer") && cfg.duration) document.getElementById("eg-gf-val-timer").value = cfg.duration;
        if (document.getElementById("eg-gf-chk-viol") && cfg.violOn !== undefined) document.getElementById("eg-gf-chk-viol").checked = cfg.violOn;
        if (document.getElementById("eg-gf-val-viol") && cfg.maxViol) document.getElementById("eg-gf-val-viol").value = cfg.maxViol;
        if (document.getElementById("eg-gf-chk-auto") && cfg.autoOn !== undefined) document.getElementById("eg-gf-chk-auto").checked = cfg.autoOn;
        if (document.getElementById("eg-gf-chk-cam") && cfg.camOn !== undefined) document.getElementById("eg-gf-chk-cam").checked = cfg.camOn;
        if (document.getElementById("eg-gf-chk-tab") && cfg.tabOn !== undefined) document.getElementById("eg-gf-chk-tab").checked = cfg.tabOn;
        if (document.getElementById("eg-gf-chk-copy") && cfg.copyOn !== undefined) document.getElementById("eg-gf-chk-copy").checked = cfg.copyOn;
        if (document.getElementById("eg-gf-chk-fs") && cfg.fsOn !== undefined) document.getElementById("eg-gf-chk-fs").checked = cfg.fsOn;
        if (document.getElementById("eg-gf-chk-wm") && cfg.wmOn !== undefined) document.getElementById("eg-gf-chk-wm").checked = cfg.wmOn;
        if (document.getElementById("eg-gf-mode") && cfg.mode) document.getElementById("eg-gf-mode").value = cfg.mode;
      } catch (e) {}
    }

    // Restore saved settings into sidebar controls
    restoreSidebarConfig();

    // Listen to all inputs to save immediately on change
    sidebar.querySelectorAll("input, select").forEach(el => {
      el.addEventListener("change", saveSidebarConfig);
      el.addEventListener("input", saveSidebarConfig);
    });

    // Close button
    document.getElementById("eg-gf-close").onclick = () => {
      sidebar.style.display = "none";
    };

    // Helper to generate public form URL and student link
    function getGeneratedStudentUrl() {
      let rawUrl = location.href;
      let viewUrl = rawUrl.replace(/\/edit.*$/, "/viewform");
      if (!viewUrl.includes("/viewform")) viewUrl += "/viewform";

      const cfg = getSidebarConfig();

      // Use GitHub Pages public portal URL so students can take the exam without installing any extension!
      const portalBase = "https://rewsuphakit.github.io/-ExamGuard/index.html";
      const url = new URL(portalBase);
      url.searchParams.set("form", viewUrl);
      url.searchParams.set("timer", cfg.timerOn ? cfg.duration : "0");
      url.searchParams.set("autoSubmit", cfg.autoOn ? "1" : "0");
      url.searchParams.set("camera", cfg.camOn ? "1" : "0");
      url.searchParams.set("tab", cfg.tabOn ? "1" : "0");
      url.searchParams.set("fullscreen", cfg.fsOn ? "1" : "0");
      url.searchParams.set("copy", cfg.copyOn ? "1" : "0");
      url.searchParams.set("watermark", cfg.wmOn ? "1" : "0");
      url.searchParams.set("studentInfo", cfg.mode === "restricted" ? "1" : "0");
      url.searchParams.set("violations", cfg.violOn ? cfg.maxViol : "99");

      return url.href;
    }

    // Copy Button
    document.getElementById("eg-gf-btn-copy").onclick = () => {
      saveSidebarConfig();
      const link = getGeneratedStudentUrl();
      navigator.clipboard.writeText(link).then(() => {
        alert("✅ คัดลอกลิงก์สอบพร้อมระบบป้องกันเรียบร้อยแล้ว!\n\nลิงก์นี้ถูกกำหนดค่าตามที่คุณเลือกไว้ (จับเวลา, บล็อกคัดลอก, เต็มจอ ฯลฯ) ครบถ้วน นำไปส่งให้นักเรียนเริ่มสอบได้ทันทีครับ\n\n(หมายเหตุ: หน้าแก้ไขข้อสอบที่คุณครูกำลังอยู่นี้จะไม่ถูกบล็อก เพื่อให้คุณครูพิมพ์คำถามได้ตามปกติ)");
      }).catch(() => {
        prompt("คัดลอกลิงก์ส่งให้นักเรียน:", link);
      });
    };

    // Preview Button (Open via background service worker to prevent ERR_BLOCKED_BY_CLIENT)
    document.getElementById("eg-gf-btn-preview").onclick = () => {
      saveSidebarConfig();
      const link = getGeneratedStudentUrl();
      chrome.runtime.sendMessage({ type: "OPEN_TAB", url: link });
    };

    // Full Dashboard Button (Open via background service worker to prevent ERR_BLOCKED_BY_CLIENT)
    document.getElementById("eg-gf-btn-dash").onclick = () => {
      const dashUrl = chrome.runtime.getURL("dashboard.html?form=" + encodeURIComponent(location.href));
      chrome.runtime.sendMessage({ type: "OPEN_TAB", url: dashUrl });
    };
  }

  initGoogleFormsEditorIntegration();
})();