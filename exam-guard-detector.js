/**
 * ============================================================================
 * Exam Guard - Webpage Detector (exam-guard-detector.js)
 * สคริปต์สำหรับนำไปใส่ใน "หน้าเว็บข้อสอบ" เพื่อตรวจสอบและบล็อกคนที่ไม่ได้ลงส่วนขยาย
 * ============================================================================
 * 
 * วิธีใช้งาน:
 * นำโค้ดนี้ไปใส่ในหน้าเว็บข้อสอบ (ใน <head> หรือ <body>):
 * <script src="exam-guard-detector.js"></script>
 */

(function () {
  // Prevent duplicate initialization
  if (window.__ExamGuardDetectorLoaded) return;
  window.__ExamGuardDetectorLoaded = true;

  const config = Object.assign(
    {
      timeoutMs: 800, // ระยะเวลารอสัญญาณจาก Extension (มิลลิวินาที)
      autoBlock: true, // บล็อกหน้าจออัตโนมัติหากไม่พบส่วนขยาย
      retryIntervalMs: 1500, // ช่วงเวลาตรวจสอบซ้ำอัตโนมัติ
      onVerified: null, // Callback เมื่อพบส่วนขยาย
      onBlocked: null,  // Callback เมื่อไม่พบส่วนขยาย
    },
    window.ExamGuardDetectorConfig || {}
  );

  let isVerified = false;
  let checkTimer = null;
  let blockerElement = null;

  // Add initial style to prevent flash of exam questions before verification
  const preStyle = document.createElement("style");
  preStyle.id = "eg-detector-pre-style";
  preStyle.textContent = `
    .eg-hidden-pending {
      visibility: hidden !important;
      opacity: 0 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(preStyle);

  // Method 1: Check DOM Attribute set by content.js at document_start
  function checkDomAttribute() {
    if (document.documentElement.getAttribute("data-exam-guard-installed") === "true") {
      verifySuccess({
        version: document.documentElement.getAttribute("data-exam-guard-version") || "2.3.0",
        method: "DOM_ATTRIBUTE"
      });
      return true;
    }
    return false;
  }

  // Method 2: Listen for Custom Events and Window Messages
  function setupListeners() {
    // Custom Event from content.js
    window.addEventListener("EXAM_GUARD_HANDSHAKE", function (e) {
      verifySuccess(Object.assign({ method: "CUSTOM_EVENT" }, e.detail));
    });

    // PostMessage response from content.js
    window.addEventListener("message", function (e) {
      if (e.data && (e.data.type === "EXAM_GUARD_PONG" || e.data.type === "EXAM_GUARD_HANDSHAKE")) {
        verifySuccess({
          version: e.data.version || "2.3.0",
          active: e.data.active,
          method: "POST_MESSAGE"
        });
      }
    });
  }

  // Send Ping to Extension
  function sendPing() {
    try {
      window.postMessage({ type: "EXAM_GUARD_PING", timestamp: Date.now() }, "*");
    } catch (e) {}
  }

  // Verification Succeeded
  function verifySuccess(detail) {
    if (isVerified) return;
    isVerified = true;
    if (checkTimer) clearTimeout(checkTimer);

    // Remove pre-hidden styles and blocker screen
    const style = document.getElementById("eg-detector-pre-style");
    if (style) style.remove();

    if (blockerElement) {
      blockerElement.remove();
      blockerElement = null;
    }
    document.body?.classList.remove("eg-detector-blocked");

    // Dispatch verification event on window for host page
    window.dispatchEvent(
      new CustomEvent("EXAM_GUARD_VERIFIED", {
        detail: Object.assign({ timestamp: Date.now() }, detail)
      })
    );

    if (typeof config.onVerified === "function") {
      config.onVerified(detail);
    }
  }

  // Verification Failed -> Show Blocker Overlay
  function triggerBlock() {
    if (isVerified) return;

    if (typeof config.onBlocked === "function") {
      config.onBlocked();
    }

    if (!config.autoBlock) return;

    showBlockerScreen();
  }

  function showBlockerScreen() {
    if (blockerElement || isVerified) return;

    // Apply body lock
    document.body?.classList.add("eg-detector-blocked");

    blockerElement = document.createElement("div");
    blockerElement.id = "eg-missing-extension-blocker";
    blockerElement.innerHTML = `
      <style>
        #eg-missing-extension-blocker {
          position: fixed !important;
          inset: 0 !important;
          z-index: 2147483647 !important;
          background: #090e1a !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          color: #f8fafc !important;
          padding: 20px !important;
          box-sizing: border-box !important;
          text-align: center !important;
        }
        .eg-db-card {
          width: min(520px, 94vw);
          background: #111a2e;
          border: 2px solid #ef4444;
          border-radius: 24px;
          padding: 36px 30px;
          box-shadow: 0 25px 80px rgba(239, 68, 68, 0.35);
          box-sizing: border-box;
          animation: egDbFadeIn 0.3s ease;
        }
        @keyframes egDbFadeIn {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .eg-db-icon {
          font-size: 54px;
          line-height: 1;
          margin-bottom: 14px;
        }
        .eg-db-title {
          font-size: 24px;
          font-weight: 800;
          color: #f87171;
          margin: 0 0 10px;
        }
        .eg-db-sub {
          font-size: 14px;
          color: #cbd5e1;
          line-height: 1.6;
          margin-bottom: 22px;
        }
        .eg-db-reasons {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid #1e293b;
          border-radius: 14px;
          padding: 16px 18px;
          text-align: left;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.7;
          margin-bottom: 24px;
        }
        .eg-db-reasons strong {
          color: #fca5a5;
          display: block;
          margin-bottom: 6px;
        }
        .eg-db-btn {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: 0;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          background: #2563eb;
          color: white;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .eg-db-btn:hover {
          background: #1d4ed8;
          transform: translateY(-1px);
        }
        .eg-db-guide {
          margin-top: 16px;
          font-size: 12px;
          color: #64748b;
        }
      </style>
      <div class="eg-db-card">
        <div class="eg-db-icon">⛔</div>
        <h2 class="eg-db-title">ไม่อนุญาตให้เข้าทำข้อสอบ</h2>
        <div class="eg-db-sub">
          ตรวจไม่พบส่วนขยาย <strong>Exam Guard</strong> ในเบราว์เซอร์ของคุณ หรือส่วนขยายถูกปิดการทำงานอยู่
        </div>

        <div class="eg-db-reasons">
          <strong>⚠️ สาเหตุที่เข้าทำข้อสอบไม่ได้:</strong>
          <div>1. คุณยังไม่ได้ติดตั้งส่วนขยาย Exam Guard บน Google Chrome</div>
          <div>2. คุณกำลังเปิดข้อสอบในเบราว์เซอร์อื่น (เช่น Edge, Safari, Firefox หรือมือถือ)</div>
          <div>3. คุณกำลังเปิดในโหมดไม่ระบุตัวตน (Incognito) โดยไม่ได้อนุญาตส่วนขยาย</div>
          <div>4. ส่วนขยายถูกปิดการใช้งาน (Disabled) ใน chrome://extensions</div>
        </div>

        <button class="eg-db-btn" id="eg-btn-retry-detector">
          🔄 ตรวจสอบส่วนขยายอีกครั้ง
        </button>

        <div class="eg-db-guide">
          * กรุณาติดตั้งและเปิดใช้งานส่วนขยาย Exam Guard บน Google Chrome ก่อนเข้าทำข้อสอบ
        </div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(blockerElement);

    const btnRetry = document.getElementById("eg-btn-retry-detector");
    if (btnRetry) {
      btnRetry.onclick = function () {
        btnRetry.textContent = "กำลังตรวจสอบ...";
        sendPing();
        setTimeout(function () {
          if (checkDomAttribute()) {
            btnRetry.textContent = "✓ ตรวจพบแล้ว!";
          } else {
            btnRetry.textContent = "❌ ยังตรวจไม่พบ (ลองอีกครั้ง)";
          }
        }, 500);
      };
    }
  }

  // Periodic re-check in background if user installs or enables extension while on page
  function setupPeriodicCheck() {
    setInterval(function () {
      if (isVerified) return;
      if (checkDomAttribute()) return;
      sendPing();
    }, config.retryIntervalMs);
  }

  // Initialization Flow
  setupListeners();

  // 1. Instant check
  if (!checkDomAttribute()) {
    sendPing();

    // 2. Schedule timeout block check
    checkTimer = setTimeout(function () {
      if (!checkDomAttribute()) {
        triggerBlock();
      }
    }, config.timeoutMs);
  }

  setupPeriodicCheck();

  // Expose Global API for web developers
  window.ExamGuardDetector = {
    isVerified: function () {
      return isVerified;
    },
    checkNow: function () {
      return checkDomAttribute();
    },
    unblock: function () {
      verifySuccess({ method: "MANUAL_OVERRIDE" });
    }
  };
})();
