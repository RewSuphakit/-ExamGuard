/**
 * ============================================================================
 * Exam Guard Web (Standalone Edition - Zero Extension Required)
 * ระบบคุมสอบออนไลน์แบบฝังในหน้าเว็บโดยตรง "ผู้สอบไม่ต้องติดตั้งส่วนขยายใดๆ"
 * รองรับทุกอุปกรณ์ (PC, Mac, แท็บเล็ต, iPad, Chromebook)
 * ============================================================================
 * 
 * วิธีใช้งาน:
 * เพียงนำไฟล์นี้ไปวางในเว็บข้อสอบ แล้วใส่แท็ก:
 * <script src="exam-guard-web.js"></script>
 */

(function () {
  // Prevent duplicate execution
  if (window.__ExamGuardWebLoaded) return;
  window.__ExamGuardWebLoaded = true;

  // อ่านพารามิเตอร์จาก URL เพื่อเปิด/ปิดฟังก์ชันได้ทันที
  const urlParams = new URLSearchParams(window.location.search);
  const urlOverrides = {};
  if (urlParams.has("timer")) {
    const t = parseInt(urlParams.get("timer"), 10);
    urlOverrides.enableTimer = t > 0;
    if (t > 0) urlOverrides.examDurationMinutes = t;
  }
  if (urlParams.has("camera")) urlOverrides.enableCamera = urlParams.get("camera") === "1" || urlParams.get("camera") === "true";
  if (urlParams.has("tab")) urlOverrides.detectTabSwitch = urlParams.get("tab") === "1" || urlParams.get("tab") === "true";
  if (urlParams.has("fullscreen")) urlOverrides.detectFullscreen = urlParams.get("fullscreen") === "1" || urlParams.get("fullscreen") === "true";
  if (urlParams.has("copy")) urlOverrides.blockCopy = urlParams.get("copy") === "1" || urlParams.get("copy") === "true";
  if (urlParams.has("watermark")) urlOverrides.enableWatermark = urlParams.get("watermark") === "1" || urlParams.get("watermark") === "true";
  if (urlParams.has("studentInfo")) urlOverrides.requireStudentInfo = urlParams.get("studentInfo") === "1" || urlParams.get("studentInfo") === "true";
  if (urlParams.has("violations")) urlOverrides.maxViolations = parseInt(urlParams.get("violations"), 10) || 3;
  if (urlParams.has("autoSubmit")) urlOverrides.autoSubmitOnTimeUp = urlParams.get("autoSubmit") === "1" || urlParams.get("autoSubmit") === "true";

  // Configuration (สามารถปรับแต่งผ่าน window.ExamGuardConfig หรือ URL ได้)
  const config = Object.assign(
    {
      maxViolations: 3,             // จำนวนครั้งที่ละเมิดได้สูงสุดก่อนตัดสิทธิ์
      examDurationMinutes: 60,      // ระยะเวลาสอบ (นาที)
      enableTimer: true,            // เปิดใช้งานระบบนับเวลาถอยหลัง
      autoSubmitOnTimeUp: true,     // ล็อกหน้าจอทันทีเมื่อหมดเวลา (Auto-Submit)
      enableCamera: true,           // เปิดใช้งานกล้องเว็บแคมบันทึกภาพ (เหมือน ExtendedForms)
      cameraIntervalMinutes: 3,     // สุ่มถ่ายภาพทุกๆ กี่นาที
      detectTabSwitch: true,        // ตรวจจับการสลับแท็บ / ย่อหน้าต่าง
      detectFullscreen: true,       // บังคับทำในโหมดเต็มหน้าจอ
      blockCopy: true,              // บล็อกการคัดลอก / ตัด / คลิกขวา
      enableWatermark: true,        // แสดงลายน้ำชื่อและรหัสผู้สอบ
      requireStudentInfo: true,     // บังคับกรอกชื่อและรหัสนักศึกษา
      proctorPin: "1234",           // รหัส PIN ผู้คุมสอบสำหรับปลดล็อก/เพิ่มเวลา
      examTitle: document.title || "แบบทดสอบออนไลน์",
      storageKey: `eg_web_${location.origin}${location.pathname}`,
      onTerminated: null,           // Callback เมื่อถูกระงับสิทธิ์
      onTimeUp: null                // Callback เมื่อหมดเวลา
    },
    window.ExamGuardConfig || {},
    urlOverrides
  );

  let started = false;
  let isTerminated = false;
  let isTimeUp = false;
  let violations = 0;
  let sessionData = null;
  let timerInterval = null;
  let timerWidget = null;
  let watermarkElement = null;
  let watermarkOverlay = null;
  let cameraStream = null;
  let cameraInterval = null;

  let warned15Min = false;
  let warned5Min = false;
  let warned1Min = false;

  let lastCopyViolationTime = 0;
  let lastKeyboardViolationTime = 0;
  let lastRightClickViolationTime = 0;
  let lastTabViolationTime = 0;
  let lastBlurViolationTime = 0;

  // ==========================================================================
  // 1. INJECT STYLES (สร้างสไตล์ทั้งหมดในตัว ไม่ต้องโหลดไฟล์ CSS แยก)
  // ==========================================================================
  function injectStyles() {
    const css = `
      :root {
        --egw-primary: #2563eb;
        --egw-primary-hover: #1d4ed8;
        --egw-danger: #ef4444;
        --egw-warning: #f59e0b;
        --egw-card-bg: #111a2e;
        --egw-border: #1e293b;
        --egw-text: #f8fafc;
        --egw-muted: #94a3b8;
        --egw-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      #egw-start-gate,
      #egw-lockout-gate,
      #egw-timeup-gate {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        background: rgba(10, 15, 29, 0.96) !important;
        backdrop-filter: blur(14px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: var(--egw-font) !important;
        color: var(--egw-text) !important;
        padding: 20px !important;
        box-sizing: border-box !important;
        overflow-y: auto !important;
      }

      .egw-card {
        width: min(520px, 94vw);
        padding: 34px 28px;
        border-radius: 24px;
        background: var(--egw-card-bg);
        border: 1px solid var(--egw-border);
        box-shadow: 0 25px 80px rgba(0, 0, 0, 0.65);
        text-align: center;
        box-sizing: border-box;
        animation: egwCardIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes egwCardIn {
        from { opacity: 0; transform: scale(0.96) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      .egw-logo { font-size: 48px; line-height: 1; margin-bottom: 8px; }
      .egw-card h1 { margin: 6px 0 8px; font-size: 24px; font-weight: 800; }
      .egw-sub { margin: 0 0 20px; color: var(--egw-muted); font-size: 13px; line-height: 1.5; }

      .egw-form-group { text-align: left; margin-bottom: 12px; }
      .egw-form-group label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
      .egw-form-group label .egw-req { color: #f87171; margin-left: 2px; }
      .egw-form-group input {
        width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px;
        border: 1px solid #334155; background: #0b1324; color: #fff; font-size: 14px;
        outline: none; font-family: inherit;
      }
      .egw-form-group input:focus { border-color: var(--egw-primary); }
      .egw-form-error { color: #f87171; font-size: 12px; margin-top: 4px; display: none; }

      .egw-list {
        text-align: left; line-height: 1.8; margin: 16px 0 20px; padding: 14px 16px;
        background: rgba(15, 23, 42, 0.6); border: 1px solid #1e293b; border-radius: 14px;
        font-size: 13px; color: #cbd5e1;
      }
      .egw-list div { display: flex; align-items: center; gap: 8px; }
      .egw-list div span.icon { color: #34d399; font-weight: bold; }

      .egw-btn {
        width: 100%; border: 0; border-radius: 14px; padding: 14px;
        background: var(--egw-primary); color: white; font-size: 16px;
        font-weight: 700; cursor: pointer; transition: all 0.15s ease;
      }
      .egw-btn:hover { background: var(--egw-primary-hover); transform: translateY(-1px); }

      /* Floating Countdown Timer Bar */
      #egw-timer-widget {
        position: fixed !important; top: 14px !important; left: 50% !important;
        transform: translateX(-50%) !important; z-index: 2147483646 !important;
        background: rgba(15, 23, 42, 0.94) !important; backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(59, 130, 246, 0.45) !important; border-radius: 999px !important;
        padding: 8px 20px !important; color: #fff !important; font-family: monospace, sans-serif !important;
        display: flex !important; align-items: center !important; gap: 8px !important;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5) !important; user-select: none !important;
      }
      #egw-timer-clock { font-size: 16px; font-weight: 800; color: #60a5fa; }
      #egw-timer-widget.egw-timer-warning { border-color: #f59e0b !important; }
      #egw-timer-widget.egw-timer-warning #egw-timer-clock { color: #fbbf24 !important; }
      #egw-timer-widget.egw-timer-critical { border-color: #ef4444 !important; animation: egwPulse 1.5s infinite; }
      #egw-timer-widget.egw-timer-critical #egw-timer-clock { color: #f87171 !important; }
      @keyframes egwPulse {
      /* Warning Modal */
      #egw-warning-overlay {
        position: fixed !important; inset: 0 !important; z-index: 2147483646 !important;
        background: rgba(10, 15, 29, 0.94) !important; backdrop-filter: blur(12px) !important;
        display: none; align-items: center !important; justify-content: center !important;
        font-family: var(--egw-font) !important; color: var(--egw-text) !important; padding: 20px !important;
        box-sizing: border-box !important; animation: egwFadeIn 0.2s ease !important;
      }
      .egw-warning-card {
        width: min(480px, 92vw); padding: 30px 24px; border-radius: 22px;
        background: #182239; border: 2px solid var(--egw-danger) !important;
        box-shadow: 0 20px 60px rgba(239, 68, 68, 0.35); text-align: center;
      }

      /* Lockout & TimeUp Cards */
      .egw-lockout-card { border: 2px solid var(--egw-danger) !important; }
      .egw-timeup-card { border: 2px solid var(--egw-warning) !important; }
      .egw-badge-tag {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px;
        border-radius: 999px; font-size: 12px; font-weight: 700; margin-bottom: 12px;
      }
      .egw-badge-danger { background: rgba(239,68,68,0.15); border: 1px solid #b91c1c; color: #fca5a5; }
      .egw-badge-warning { background: rgba(245,158,11,0.15); border: 1px solid #d97706; color: #fbbf24; }

      .egw-info-box {
        background: #182239; border: 1px solid #283755; border-radius: 14px;
        padding: 12px 16px; margin: 16px 0; text-align: left; font-size: 13px;
      }
      .egw-info-row { display: flex; justify-content: space-between; padding: 3px 0; }
      .egw-info-row span:first-child { color: var(--egw-muted); }
      .egw-info-row span:last-child { font-weight: 700; color: #fff; }

      .egw-logs-list {
        background: rgba(0,0,0,0.4); border: 1px solid #334155; border-radius: 12px;
        padding: 12px; max-height: 140px; overflow-y: auto; text-align: left; font-size: 12px; margin: 14px 0;
      }
      .egw-log-item { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
      .egw-log-num { background: #ef4444; color: #fff; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }

      /* Watermark */
      #egw-watermark {
        position: fixed !important; right: 14px !important; bottom: 12px !important;
        z-index: 2147483645 !important; padding: 4px 10px !important; border-radius: 6px !important;
        background: rgba(0, 0, 0, 0.4) !important; color: rgba(255, 255, 255, 0.45) !important;
        font: 11px var(--egw-font) !important; pointer-events: none !important; user-select: none !important;
      }
      .egw-watermark-overlay {
        position: fixed !important; inset: 0 !important; z-index: 2147483644 !important;
        pointer-events: none !important; user-select: none !important; opacity: 0.08 !important; background-repeat: repeat !important;
      }

      /* Toasts */
      #egw-toast {
        position: fixed !important; right: 22px !important; top: 22px !important;
        z-index: 2147483647 !important; display: none; padding: 14px 18px !important;
        border-radius: 14px !important; background: #161f38 !important; border: 1px solid #283755 !important;
        color: #fff !important; box-shadow: 0 10px 35px rgba(0,0,0,0.5) !important;
        font-family: var(--egw-font) !important; font-size: 13px !important; max-width: 340px !important;
      }
      #egw-toast.egw-toast-danger { background: #3b111a !important; border-color: #ef4444 !important; }
      #egw-toast.egw-toast-warning { background: #3b2811 !important; border-color: #f59e0b !important; }
      #egw-toast b { display: block; margin-bottom: 2px; }

      .egw-body-locked { overflow: hidden !important; user-select: none !important; }
      .egw-no-select, .egw-no-select * { user-select: none !important; -webkit-user-select: none !important; }

      /* Webcam Picture-in-Picture Box (ExtendedForms Style) */
      #egw-camera-box {
        position: fixed !important; bottom: 20px !important; left: 20px !important;
        width: 154px !important; height: 116px !important; border-radius: 14px !important;
        overflow: hidden !important; background: #000 !important; border: 2px solid #3b82f6 !important;
        box-shadow: 0 10px 25px rgba(0,0,0,0.6) !important; z-index: 2147483643 !important;
        user-select: none !important;
      }
      #egw-camera-video {
        width: 100% !important; height: 100% !important; object-fit: cover !important;
        transform: scaleX(-1) !important;
      }
      #egw-camera-badge {
        position: absolute !important; top: 6px !important; left: 6px !important;
        background: rgba(0,0,0,0.7) !important; color: #f87171 !important;
        font-size: 10px !important; font-weight: 700 !important; padding: 2px 6px !important;
        border-radius: 6px !important; display: flex !important; align-items: center !important; gap: 4px !important;
      }
      #egw-camera-badge::before {
        content: "" !important; display: inline-block !important; width: 6px !important; height: 6px !important;
        border-radius: 50% !important; background: #ef4444 !important; animation: egwBlink 1s infinite !important;
      }
      @keyframes egwBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

      /* Snapshots Gallery Modal */
      #egw-gallery-modal {
        position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
        background: rgba(10, 15, 29, 0.95) !important; backdrop-filter: blur(10px) !important;
        display: none; align-items: center; justify-content: center; padding: 20px;
        font-family: var(--egw-font) !important; color: var(--egw-text) !important;
      }
      .egw-gallery-card {
        background: var(--egw-card-bg); border: 1px solid var(--egw-border);
        border-radius: 20px; width: min(720px, 95vw); max-height: 85vh;
        display: flex; flex-direction: column; overflow: hidden; padding: 24px;
        box-shadow: 0 25px 70px rgba(0,0,0,0.7); box-sizing: border-box;
      }
      .egw-gallery-header {
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #1e293b; padding-bottom: 14px; margin-bottom: 14px;
      }
      .egw-gallery-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px; overflow-y: auto; padding: 4px;
      }
      .egw-snap-item {
        background: #0b1324; border: 1px solid #1e293b; border-radius: 12px;
        overflow: hidden; text-align: center; font-size: 11px;
      }
      .egw-snap-item img { width: 100%; height: 110px; object-fit: cover; display: block; }
      .egw-snap-caption { padding: 6px; color: #94a3b8; font-size: 10px; }
    `;
    const styleEl = document.createElement("style");
    styleEl.id = "egw-styles";
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // Helpers
  function formatTime(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDateTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return `${d.toLocaleDateString("th-TH")} ${d.toLocaleTimeString("th-TH")}`;
  }

  function showToast(title, message, type = "normal") {
    let t = document.getElementById("egw-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "egw-toast";
      document.body.appendChild(t);
    }
    t.className = type === "danger" ? "egw-toast-danger" : (type === "warning" ? "egw-toast-warning" : "");
    t.innerHTML = `<b>${title}</b><span>${message}</span>`;
    t.style.display = "block";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      if (t) t.style.display = "none";
    }, type === "danger" ? 4000 : 2800);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Save session to LocalStorage (Anti-F5 Persistence)
  function saveSession() {
    if (!sessionData) return;
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(sessionData));
    } catch (e) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(config.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ==========================================================================
  // 2. START GATE (ลงทะเบียนก่อนเริ่มสอบ)
  // ==========================================================================
  function showStartGate() {
    if (document.getElementById("egw-start-gate") || document.getElementById("egw-lockout-gate") || document.getElementById("egw-timeup-gate")) return;

    const el = document.createElement("div");
    el.id = "egw-start-gate";
    el.innerHTML = `
      <div class="egw-card">
        <div class="egw-logo">🛡️</div>
        <h1>Exam Guard Web</h1>
        <p class="egw-sub">ระบบคุมสอบออนไลน์อัตโนมัติ (ไม่ต้องติดตั้งส่วนขยายใดๆ)</p>

        <div class="egw-form-group">
          <label>ชื่อ - นามสกุล ผู้สอบ <span class="egw-req">*</span></label>
          <input type="text" id="egw-name" placeholder="เช่น นายสมชาย ใจดี" autocomplete="off" />
          <div class="egw-form-error" id="egw-err-name">กรุณาระบุชื่อ-นามสกุล</div>
        </div>

        <div style="display:flex; gap:10px;">
          <div class="egw-form-group" style="flex:1.2;">
            <label>รหัสนักศึกษา / เลขประจำตัว <span class="egw-req">*</span></label>
            <input type="text" id="egw-id" placeholder="เช่น 64010123" autocomplete="off" />
            <div class="egw-form-error" id="egw-err-id">กรุณาระบุรหัสนักศึกษา</div>
          </div>
          <div class="egw-form-group" style="flex:0.8;">
            <label>ห้องสอบ / ที่นั่ง</label>
            <input type="text" id="egw-seat" placeholder="เช่น ห้อง 4 / A-12" autocomplete="off" />
          </div>
        </div>

        <div class="egw-list">
          ${config.enableTimer ? `<div><span class="icon">⏱️</span> <strong>จำกัดเวลาทำข้อสอบ:</strong> ${config.examDurationMinutes} นาที</div>` : ''}
          ${config.enableCamera ? `<div><span class="icon">📷</span> <strong>เปิดกล้องเว็บแคม (Proctoring):</strong> บันทึกภาพยืนยันตัวตนระหว่างสอบ</div>` : ''}
          <div><span class="icon">✓</span> บังคับทำข้อสอบในโหมดเต็มหน้าจอ (Fullscreen)</div>
          <div><span class="icon">✓</span> ตรวจจับการสลับแท็บ ย่อเบราว์เซอร์ หรือเปิดแอปอื่น</div>
          <div><span class="icon">✓</span> ป้องกันการคัดลอก ตัด วาง และลากคลุมข้อความ</div>
          <div><span class="icon">✓</span> แสดง Watermark ระบุตัวตนป้องกันการใช้มือถือแอบถ่าย</div>
          <div><span class="icon">⛔</span> <strong>ระงับการสอบทันที</strong> หากทำผิดกฎครบ ${config.maxViolations} ครั้ง</div>
        </div>

        <button class="egw-btn" id="egw-btn-start">เริ่มทำข้อสอบ</button>
        <small style="display:block; margin-top:12px; color:var(--egw-muted); font-size:12px;">
          เมื่อกดเริ่ม ระบบจะขออนุญาตเข้าสู่โหมดเต็มหน้าจอและเริ่มจับเวลาทันที
        </small>
      </div>
    `;

    document.body.appendChild(el);

    document.getElementById("egw-btn-start").onclick = handleStartClick;
  }

  async function handleStartClick() {
    const inputName = document.getElementById("egw-name");
    const inputId = document.getElementById("egw-id");
    const inputSeat = document.getElementById("egw-seat");
    const errName = document.getElementById("egw-err-name");
    const errId = document.getElementById("egw-err-id");

    const name = inputName?.value.trim() || "";
    const id = inputId?.value.trim() || "";
    const seat = inputSeat?.value.trim() || "-";

    let hasError = false;
    if (config.requireStudentInfo) {
      if (!name) { errName.style.display = "block"; hasError = true; } else { errName.style.display = "none"; }
      if (!id) { errId.style.display = "block"; hasError = true; } else { errId.style.display = "none"; }
    }
    if (hasError) return;

    sessionData = {
      studentName: name || "ผู้เข้าสอบ",
      studentId: id || "N/A",
      seatNumber: seat,
      startTime: Date.now(),
      violations: 0,
      durationMinutes: config.examDurationMinutes,
      status: "active",
      terminatedAt: null,
      logs: []
    };
    saveSession();

    startExam();
  }

  async function startExam() {
    started = true;
    isTerminated = false;
    isTimeUp = false;
    violations = sessionData.violations || 0;

    document.getElementById("egw-start-gate")?.remove();
    document.body.classList.add("egw-no-select");

    // Request Fullscreen
    try {
      await document.documentElement.requestFullscreen?.();
    } catch (e) {}

    setupWatermarks();

    if (config.enableTimer) {
      initExamTimer();
    }

    if (config.enableCamera) {
      initCamera();
    }

    showToast("🛡️ Exam Guard Web", `เริ่มการสอบ: ${sessionData.studentName} (${sessionData.studentId})`);
  }

  // ==========================================================================
  // 3. EXAM TIMER WIDGET (ระบบจับเวลานับถอยหลัง)
  // ==========================================================================
  function initExamTimer() {
    if (timerInterval) clearInterval(timerInterval);

    if (!timerWidget) {
      timerWidget = document.createElement("div");
      timerWidget.id = "egw-timer-widget";
      timerWidget.innerHTML = `
        <span>⏱️</span>
        <span style="font-size:12px; color:#94a3b8;">เวลาที่เหลือ:</span>
        <span id="egw-timer-clock">--:--</span>
      `;
      document.body.appendChild(timerWidget);
    }

    function tick() {
      if (!started || isTerminated || isTimeUp || !sessionData) return;

      const durationMs = (sessionData.durationMinutes || config.examDurationMinutes) * 60 * 1000;
      const endTime = sessionData.startTime + durationMs;
      const remainingMs = endTime - Date.now();

      if (remainingMs <= 0) {
        clearInterval(timerInterval);
        triggerTimeUp();
        return;
      }

      const totalSec = Math.floor(remainingMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const pad = n => String(n).padStart(2, "0");

      const clockEl = document.getElementById("egw-timer-clock");
      if (clockEl) {
        clockEl.textContent = hours > 0 ? `${pad(hours)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
      }

      // Warning color cues
      if (remainingMs <= 5 * 60 * 1000) {
        timerWidget?.classList.add("egw-timer-critical");
        timerWidget?.classList.remove("egw-timer-warning");
        if (!warned5Min) {
          warned5Min = true;
          showToast("⚠️ ใกล้หมดเวลาสอบ", "เหลือเวลาทำข้อสอบอีก 5 นาที กรุณาตรวจสอบคำตอบ", "warning");
        }
      } else if (remainingMs <= 15 * 60 * 1000) {
        timerWidget?.classList.add("egw-timer-warning");
        if (!warned15Min) {
          warned15Min = true;
          showToast("⏱️ แจ้งเตือนเวลาสอบ", "เหลือเวลาทำข้อสอบอีก 15 นาที", "warning");
        }
      }

      if (remainingMs <= 60 * 1000 && !warned1Min) {
        warned1Min = true;
        showToast("🚨 เหลือเวลาอีก 1 นาที", "ระบบจะปิดรับคำตอบอัตโนมัติเมื่อหมดเวลา", "danger");
      }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function triggerTimeUp() {
    isTimeUp = true;
    started = false;

    if (timerWidget) { timerWidget.remove(); timerWidget = null; }
    if (sessionData) {
      sessionData.status = "timeup";
      sessionData.terminatedAt = Date.now();
      saveSession();
    }

    document.body.classList.add("egw-body-locked");
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch {}
    }

    showTimeUpGate();
    if (typeof config.onTimeUp === "function") config.onTimeUp(sessionData);
  }

  function showTimeUpGate() {
    let gate = document.getElementById("egw-timeup-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "egw-timeup-gate";
      document.body.appendChild(gate);
    }

    gate.innerHTML = `
      <div class="egw-card egw-timeup-card">
        <div class="egw-badge-tag egw-badge-warning">⌛ TIME'S UP • หมดเวลาการสอบ</div>
        <h1 style="color:#fbbf24;">หมดเวลาทำข้อสอบแล้ว</h1>
        <p class="egw-sub" style="color:#fde68a;">ครบกำหนดระยะเวลาทำข้อสอบ (${sessionData?.durationMinutes || config.examDurationMinutes} นาที)</p>

        <div class="egw-info-box">
          <div class="egw-info-row"><span>ผู้เข้าสอบ:</span><span style="color:#60a5fa;">${escapeHtml(sessionData?.studentName)}</span></div>
          <div class="egw-info-row"><span>รหัสนักศึกษา:</span><span>${escapeHtml(sessionData?.studentId)}</span></div>
          <div class="egw-info-row"><span>ห้อง / ที่นั่ง:</span><span>${escapeHtml(sessionData?.seatNumber)}</span></div>
          <div class="egw-info-row"><span>การละเมิดระหว่างสอบ:</span><span style="color:${violations > 0 ? '#fbbf24' : '#34d399'};">${violations}/${config.maxViolations} ครั้ง</span></div>
        </div>

        <div style="background:rgba(245,158,11,0.15); border-left:4px solid #f59e0b; padding:12px; border-radius:8px; font-size:13px; color:#fef3c7; text-align:left; margin:14px 0;">
          ⌛ การสอบสิ้นสุดลงแล้ว ระบบได้ปิดกั้นการแก้ไขคำตอบเรียบร้อยแล้ว กรุณาวางมือและรอคำสั่งจากอาจารย์ผู้คุมสอบ
        </div>

        <!-- Proctor Extra Time -->
        <div style="margin-top:16px; border-top:1px solid #334155; padding-top:14px;">
          <small style="color:var(--egw-muted); display:block; margin-bottom:8px;">สำหรับอาจารย์ (ใส่ PIN เพื่อเพิ่มเวลาฉุกเฉิน):</small>
          <div style="display:flex; gap:8px;">
            <input type="password" id="egw-timeup-pin" placeholder="กรอก PIN ผู้คุมสอบ" style="flex:1; padding:10px; border-radius:10px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:13px;" />
            <select id="egw-extra-mins" style="background:#0f172a; color:#fff; border:1px solid #475569; border-radius:10px; padding:0 8px; font-size:13px;">
              <option value="5">+5 นาที</option>
              <option value="10">+10 นาที</option>
              <option value="15">+15 นาที</option>
            </select>
            <button id="egw-btn-extra" class="egw-btn" style="width:auto; padding:10px 14px; font-size:13px; background:#d97706;">⏱️ เพิ่มเวลา</button>
          </div>
          <div id="egw-timeup-msg" style="color:#f87171; font-size:12px; margin-top:6px; display:none;"></div>
        </div>
      </div>
    `;

    document.getElementById("egw-btn-extra").onclick = handleGrantExtraTime;
  }

  function handleGrantExtraTime() {
    const entered = document.getElementById("egw-timeup-pin")?.value.trim() || "";
    const extra = Number(document.getElementById("egw-extra-mins")?.value) || 5;
    const msg = document.getElementById("egw-timeup-msg");

    if (entered === config.proctorPin) {
      isTimeUp = false;
      started = true;
      sessionData.durationMinutes = (sessionData.durationMinutes || config.examDurationMinutes) + extra;
      sessionData.status = "active";
      saveSession();

      document.body.classList.remove("egw-body-locked");
      document.getElementById("egw-timeup-gate")?.remove();

      warned15Min = false;
      warned5Min = false;
      warned1Min = false;
      initExamTimer();

      showToast("⏱️ เพิ่มเวลาสอบสำเร็จ", `เพิ่มเวลาให้ ${extra} นาที สามารถทำข้อสอบต่อได้`);
    } else {
      if (msg) { msg.textContent = "รหัส PIN ไม่ถูกต้อง!"; msg.style.display = "block"; }
    }
  }

  // ==========================================================================
  // 4. WATERMARK SYSTEM
  // ==========================================================================
  function setupWatermarks() {
    if (!config.enableWatermark) return;
    if (!watermarkElement && sessionData) {
      watermarkElement = document.createElement("div");
      watermarkElement.id = "egw-watermark";
      watermarkElement.textContent = `🛡️ EXAM GUARD • ${sessionData.studentId} • ${sessionData.studentName} • ${new Date().toLocaleTimeString('th-TH')}`;
      document.body.appendChild(watermarkElement);
    }

    if (!watermarkOverlay && sessionData) {
      watermarkOverlay = document.createElement("div");
      watermarkOverlay.className = "egw-watermark-overlay";
      const text = `${sessionData.studentId} ${sessionData.studentName}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
        <text x="20" y="80" fill="gray" font-size="14" font-family="Arial" transform="rotate(-20 20,80)">${text}</text>
      </svg>`;
      watermarkOverlay.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
      document.body.appendChild(watermarkOverlay);
    }
  }

  // ==========================================================================
  // 4.1 WEBCAM PROCTORING SYSTEM (เปิดกล้องบันทึกภาพเหมือน ExtendedForms)
  // ==========================================================================
  async function initCamera() {
    if (!config.enableCamera) return;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false
      });
      createCameraWidget();
      // ถ่ายภาพยืนยันตัวตนภาพแรกหลังเปิดกล้อง 2 วินาที
      setTimeout(() => {
        captureSnapshot("ยืนยันตัวตนตอนเริ่มทำข้อสอบ");
      }, 2000);
      // สุ่มถ่ายภาพประจำรอบทุกๆ X นาที
      if (config.cameraIntervalMinutes > 0) {
        if (cameraInterval) clearInterval(cameraInterval);
        cameraInterval = setInterval(() => {
          if (!started || isTerminated || isTimeUp) return;
          captureSnapshot(`สุ่มบันทึกภาพประจำรอบ (${new Date().toLocaleTimeString("th-TH")})`);
        }, config.cameraIntervalMinutes * 60 * 1000);
      }
    } catch (err) {
      console.warn("Camera access denied or unavailable:", err);
      showToast("⚠️ ไม่สามารถเปิดกล้องได้", "อาจไม่มีเว็บแคมหรือยังไม่ได้อนุญาตการใช้กล้อง", "warning");
    }
  }

  function createCameraWidget() {
    if (document.getElementById("egw-camera-box")) return;
    const box = document.createElement("div");
    box.id = "egw-camera-box";
    box.innerHTML = `
      <div id="egw-camera-badge">REC</div>
      <video id="egw-camera-video" autoplay playsinline muted></video>
    `;
    document.body.appendChild(box);
    const v = document.getElementById("egw-camera-video");
    if (v && cameraStream) {
      v.srcObject = cameraStream;
    }
  }

  function captureSnapshot(reason) {
    if (!cameraStream) return;
    const v = document.getElementById("egw-camera-video");
    if (!v || v.readyState < 2) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      if (!sessionData) return;
      if (!sessionData.snapshots) sessionData.snapshots = [];
      sessionData.snapshots.push({
        time: Date.now(),
        reason: reason,
        image: dataUrl
      });
      if (sessionData.snapshots.length > 25) {
        sessionData.snapshots.shift();
      }
      saveSession();
    } catch (e) {
      console.error("Capture snapshot failed:", e);
    }
  }

  function showGalleryModal() {
    let modal = document.getElementById("egw-gallery-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "egw-gallery-modal";
      document.body.appendChild(modal);
    }
    const snaps = (sessionData && sessionData.snapshots) ? sessionData.snapshots : [];
    let itemsHtml = "";
    if (snaps.length === 0) {
      itemsHtml = `<div style="grid-column: 1/-1; text-align:center; padding: 30px; color:#94a3b8;">ยังไม่มีภาพถ่ายบันทึกจากกล้องเว็บแคม</div>`;
    } else {
      snaps.forEach(s => {
        itemsHtml += `
          <div class="egw-snap-item">
            <img src="${s.image}" alt="Snapshot" />
            <div class="egw-snap-caption">
              <div><strong>${formatTime(s.time)}</strong></div>
              <div>${escapeHtml(s.reason)}</div>
            </div>
          </div>
        `;
      });
    }

    modal.innerHTML = `
      <div class="egw-gallery-card">
        <div class="egw-gallery-header">
          <h2 style="margin:0; font-size:18px;">📷 ภาพถ่ายจากกล้องเว็บแคม (${snaps.length} ภาพ)</h2>
          <button type="button" style="background:#334155; color:#fff; border:0; padding:6px 12px; border-radius:8px; cursor:pointer;" onclick="document.getElementById('egw-gallery-modal').style.display='none'">✕ ปิด</button>
        </div>
        <div class="egw-gallery-grid">${itemsHtml}</div>
      </div>
    `;
    modal.style.display = "flex";
  }

  // ==========================================================================
  // 5. VIOLATION TRACKING & AUDIT LOGGING
  // ==========================================================================
  function addViolation(type, detail) {
    if (!started || isTerminated || isTimeUp) return;

    const now = Date.now();
    violations++;

    // ถ่ายภาพผู้สอบทันทีเมื่อตรวจพบการละเมิด
    if (config.enableCamera) {
      captureSnapshot(`พบการละเมิดครั้งที่ ${violations}: ${detail}`);
    }

    const logEntry = {
      id: `log_${now}`,
      time: now,
      type,
      detail,
      violationNumber: violations
    };

    if (sessionData) {
      sessionData.violations = violations;
      if (!sessionData.logs) sessionData.logs = [];
      sessionData.logs.push(logEntry);
      saveSession();
    }

    if (violations >= config.maxViolations) {
      isTerminated = true;
      started = false;
      if (sessionData) {
        sessionData.status = "terminated";
        sessionData.terminatedAt = now;
        saveSession();
      }

      if (timerWidget) timerWidget.remove();
      if (timerInterval) clearInterval(timerInterval);

      terminateExam(sessionData, detail);
    } else {
      showViolationModal(detail, violations, config.maxViolations);
    }
  }

  function showViolationModal(detail, current, max) {
    let overlay = document.getElementById("egw-warning-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "egw-warning-overlay";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="egw-warning-card">
        <div style="font-size: 46px; margin-bottom: 8px;">⚠️</div>
        <h2 style="color: #f87171; margin: 0 0 10px; font-size: 20px; font-weight: 800;">ตรวจพบการละเมิดกฎการสอบ!</h2>
        <p style="font-size: 14px; margin: 0 0 16px; color: #f1f5f9; line-height: 1.5;">${escapeHtml(detail)}</p>
        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 14px; padding: 14px 16px; margin-bottom: 22px;">
          <div style="color: #f87171; font-weight: 800; font-size: 16px; margin-bottom: 4px;">
            ละเมิดครั้งที่ ${current} / ${max} ครั้ง
          </div>
          <div style="color: #94a3b8; font-size: 12px; line-height: 1.4;">
            หากทำผิดกฎครบ ${max} ครั้ง ระบบจะล็อกหน้าจอและตัดสิทธิ์การสอบทันที
          </div>
        </div>
        <button type="button" id="egw-btn-resume-exam" class="egw-btn" style="background: #ef4444; width: 100%;">
          รับทราบและกลับไปทำข้อสอบต่อ
        </button>
      </div>
    `;
    overlay.style.display = "flex";

    document.getElementById("egw-btn-resume-exam").onclick = async () => {
      overlay.style.display = "none";
      try {
        await document.documentElement.requestFullscreen?.();
      } catch (e) {}
    };
  }

  // ==========================================================================
  // 6. LOCKDOWN SCREEN (เมื่อทำผิดกฎครบกำหนด)
  // ==========================================================================
  function terminateExam(session, reason) {
    isTerminated = true;
    started = false;

    document.getElementById("egw-start-gate")?.remove();
    if (timerWidget) timerWidget.remove();
    if (timerInterval) clearInterval(timerInterval);

    document.body.classList.add("egw-body-locked");
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch {}
    }
    try { document.activeElement?.blur?.(); } catch {}

    showLockoutGate(session, reason);
    if (typeof config.onTerminated === "function") config.onTerminated(session);
  }

  function showLockoutGate(session, currentReason) {
    let gate = document.getElementById("egw-lockout-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "egw-lockout-gate";
      document.body.appendChild(gate);
    }

    const logs = session?.logs || [];
    let timelineHtml = logs.map(l => `
      <div class="egw-log-item">
        <div class="egw-log-num">${l.violationNumber || "!"}</div>
        <div style="flex:1;">
          <div style="color:#f1f5f9; font-weight:600;">${escapeHtml(l.detail)}</div>
          <div style="color:#94a3b8; font-size:11px;">${formatTime(l.time)}</div>
        </div>
      </div>
    `).join("");

    if (!timelineHtml) {
      timelineHtml = `<div style="color:#cbd5e1;">${escapeHtml(currentReason || "ละเมิดกฎการสอบครบกำหนด")}</div>`;
    }

    gate.innerHTML = `
      <div class="egw-card egw-lockout-card">
        <div class="egw-badge-tag egw-badge-danger">⛔ EXAM TERMINATED • สิ้นสุดสิทธิ์การสอบ</div>
        <h1 style="color:#f87171;">การสอบถูกระงับสิทธิ์ทันที</h1>
        <p class="egw-sub" style="color:#fca5a5;">
          ตรวจพบการทำผิดกฎการสอบครบจำนวนที่กำหนด (${violations}/${config.maxViolations} ครั้ง)
        </p>

        <div class="egw-info-box">
          <div class="egw-info-row"><span>ผู้เข้าสอบ:</span><span style="color:#60a5fa;">${escapeHtml(session?.studentName)}</span></div>
          <div class="egw-info-row"><span>รหัสนักศึกษา:</span><span>${escapeHtml(session?.studentId)}</span></div>
          <div class="egw-info-row"><span>ห้อง / ที่นั่ง:</span><span>${escapeHtml(session?.seatNumber)}</span></div>
          <div class="egw-info-row"><span>เวลาที่ถูกระงับ:</span><span style="color:#f87171;">${formatDateTime(session?.terminatedAt || Date.now())}</span></div>
        </div>

        <div class="egw-logs-list">
          <div style="font-size:11px; font-weight:700; color:#fca5a5; margin-bottom:6px; text-transform:uppercase;">ประวัติการละเมิด:</div>
          ${timelineHtml}
        </div>

        <div style="background:rgba(239,68,68,0.15); border-left:4px solid #ef4444; padding:12px; border-radius:8px; font-size:13px; color:#fecaca; text-align:left; margin:14px 0;">
          ⚠️ <strong>คำสั่ง:</strong> คุณถูกตัดสิทธิ์การทำข้อสอบในครั้งนี้เรียบร้อยแล้ว กรุณานั่งรออยู่กับที่และติดต่ออาจารย์ผู้คุมสอบในห้อง
        </div>

        <!-- Proctor Unlock -->
        <div style="margin-top:16px; border-top:1px solid #334155; padding-top:14px;">
          <small style="color:var(--egw-muted); display:block; margin-bottom:8px;">สำหรับอาจารย์ (ใส่ PIN เพื่อปลดล็อก):</small>
          <div style="display:flex; gap:8px;">
            <input type="password" id="egw-unlock-pin" placeholder="กรอก PIN ผู้คุมสอบ" style="flex:1; padding:10px; border-radius:10px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:13px;" />
            <button id="egw-btn-unlock" class="egw-btn" style="width:auto; padding:10px 18px; font-size:13px; background:#334155;">🔓 ปลดล็อก</button>
          </div>
          <div id="egw-unlock-msg" style="color:#f87171; font-size:12px; margin-top:6px; display:none;"></div>
        </div>
      </div>
    `;

    document.getElementById("egw-btn-unlock").onclick = handleProctorUnlock;
  }

  function handleProctorUnlock() {
    const entered = document.getElementById("egw-unlock-pin")?.value.trim() || "";
    const msg = document.getElementById("egw-unlock-msg");

    if (entered === config.proctorPin) {
      isTerminated = false;
      started = true;
      violations = 0;
      sessionData.violations = 0;
      sessionData.status = "active";
      saveSession();

      document.body.classList.remove("egw-body-locked");
      document.getElementById("egw-lockout-gate")?.remove();

      if (config.enableTimer) initExamTimer();

      showToast("🔓 ปลดล็อกสำเร็จ", "ผู้คุมสอบทำการปลดล็อกให้สอบต่อ รีเซ็ตจำนวนครั้งแล้ว");
    } else {
      if (msg) { msg.textContent = "รหัส PIN ไม่ถูกต้อง!"; msg.style.display = "block"; }
    }
  }

  // ==========================================================================
  // 7. EVENT LISTENERS FOR ANTI-CHEAT (ตรวจจับความผิดฝั่งหน้าเว็บ)
  // ==========================================================================

  // บล็อกการลากคลุมข้อความ (ไม่นับเป็นความผิด ป้องกันเผลอลากแล้วโดนตัดสิทธิ์)
  document.addEventListener("selectstart", e => {
    if (!started || isTerminated || isTimeUp || !config.blockCopy) return;
    e.preventDefault();
  }, true);

  // คัดลอกและตัดข้อความ (Cooldown 2.5s)
  document.addEventListener("copy", e => {
    if (!started || isTerminated || isTimeUp || !config.blockCopy) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastCopyViolationTime < 2500) return;
    lastCopyViolationTime = now;
    addViolation("copy", "พยายามคัดลอกข้อความ (Copy)");
  }, true);

  document.addEventListener("cut", e => {
    if (!started || isTerminated || isTimeUp || !config.blockCopy) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastCopyViolationTime < 2500) return;
    lastCopyViolationTime = now;
    addViolation("copy", "พยายามตัดข้อความ (Cut)");
  }, true);

  // คลิกขวา (Cooldown 2.5s)
  document.addEventListener("contextmenu", e => {
    if (!started || isTerminated || isTimeUp || !config.blockCopy) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastRightClickViolationTime < 2500) return;
    lastRightClickViolationTime = now;
    addViolation("contextmenu", "พยายามคลิกขวาเปิดเมนู");
  }, true);

  // ตรวจจับคีย์ลัดต้องห้าม
  document.addEventListener("keydown", e => {
    if (isTerminated || isTimeUp) {
      if (e.target && (e.target.id === "egw-unlock-pin" || e.target.id === "egw-timeup-pin")) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!started || e.repeat) return;

    const k = e.key.toLowerCase();
    const now = Date.now();

    // Ctrl+C, Ctrl+X
    if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "x")) {
      e.preventDefault();
      e.stopPropagation();
      if (now - lastCopyViolationTime < 2500) return;
      lastCopyViolationTime = now;
      addViolation("copy", `กดคีย์ลัดคัดลอก/ตัด: ${e.ctrlKey ? 'Ctrl+' : 'Cmd+'}${e.key.toUpperCase()}`);
      return;
    }

    // Ctrl+A, S, P, V, U
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

    // F12 or DevTools
    if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k))) {
      e.preventDefault();
      e.stopPropagation();
      if (now - lastKeyboardViolationTime < 2000) return;
      lastKeyboardViolationTime = now;
      addViolation("devtools", "พยายามเปิด Developer Tools");
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

  // ตรวจจับการสลับแท็บ / ย่อหน้าต่าง
  document.addEventListener("visibilitychange", () => {
    if (started && !isTerminated && !isTimeUp && document.hidden && config.detectTabSwitch) {
      const now = Date.now();
      if (now - lastTabViolationTime < 1500) return;
      lastTabViolationTime = now;
      addViolation("tab", "สลับแท็บเบราว์เซอร์ หรือย่อหน้าต่างลง");
    }
  });

  window.addEventListener("blur", () => {
    if (!started || isTerminated || isTimeUp || !config.detectTabSwitch) return;
    setTimeout(() => {
      if (!started || isTerminated || isTimeUp) return;
      // ตรวจสอบว่าเบราว์เซอร์หลุดโฟกัสจริงหรือไม่ (เช่น สลับไปใช้โปรแกรมอื่น, คลิกทาสก์บาร์)
      if (!document.hasFocus() && !document.hidden) {
        const now = Date.now();
        if (now - lastTabViolationTime < 1500) return;
        if (now - lastBlurViolationTime < 2000) return;
        lastBlurViolationTime = now;
        addViolation("blur", "สลับไปใช้งานโปรแกรมอื่น หรือคลิกออกนอกหน้าจอสอบ");
      }
    }, 150);
  });

  // ตรวจจับการออกจากโหมดเต็มหน้าจอ
  document.addEventListener("fullscreenchange", () => {
    if (started && !isTerminated && !isTimeUp && !document.fullscreenElement && config.detectFullscreen) {
      addViolation("fullscreen", "ออกจากโหมดเต็มหน้าจอ (Fullscreen)");
    }
  });

  window.addEventListener("beforeunload", e => {
    if (started && !isTerminated && !isTimeUp) {
      e.preventDefault();
      e.returnValue = "การสอบกำลังดำเนินอยู่ หากออกจากหน้านี้ระบบจะบันทึกประวัติ";
    }
  });

  // ==========================================================================
  // 8. INITIALIZATION
  // ==========================================================================
  function init() {
    injectStyles();

    // Check existing session in LocalStorage (Anti-F5 Bypass)
    const existing = loadSession();
    if (existing) {
      sessionData = existing;
      violations = existing.violations || 0;

      // If terminated
      if (existing.status === "terminated" || violations >= config.maxViolations) {
        terminateExam(existing, "ตรวจพบสถานะถูกระงับสิทธิ์การสอบจากการทำผิดกฎก่อนหน้านี้");
        return;
      }

      // If time is up
      if (existing.status === "timeup") {
        triggerTimeUp();
        return;
      }

      // Check expired time
      if (config.enableTimer) {
        const durationMs = (existing.durationMinutes || config.examDurationMinutes) * 60 * 1000;
        if (Date.now() >= existing.startTime + durationMs) {
          triggerTimeUp();
          return;
        }
      }

      // Restore active exam
      if (existing.status === "active") {
        started = true;
        document.body.classList.add("egw-no-select");
        setupWatermarks();
        if (config.enableTimer) initExamTimer();
        if (config.enableCamera) initCamera();
        showToast("🛡️ ดำเนินการสอบต่อ", `ผู้สอบ: ${existing.studentName} (ละเมิด ${violations}/${config.maxViolations})`);
        return;
      }
    }

    // Show registration gate
    showStartGate();
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose Global Helper for Teachers
  window.ExamGuardWeb = {
    getSession: () => sessionData,
    resetSession: () => {
      localStorage.removeItem(config.storageKey);
      location.reload();
    },
    viewSnapshots: () => {
      showGalleryModal();
    },
    exportReportCsv: () => {
      if (!sessionData) return alert("ยังไม่มีข้อมูลการสอบ");
      const logs = (sessionData.logs || []).map(l => `[${formatTime(l.time)}] ${l.detail}`).join(" | ");
      const csv = "\uFEFFรหัสนักศึกษา,ชื่อ,ห้อง/ที่นั่ง,เวลาเริ่ม,สถานะ,ละเมิด,ประวัติ\n" +
        `"${sessionData.studentId}","${sessionData.studentName}","${sessionData.seatNumber}","${formatDateTime(sessionData.startTime)}","${sessionData.status}","${sessionData.violations}","${logs}"`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ExamReport_${sessionData.studentId}.csv`;
      a.click();
    }
  };
})();
