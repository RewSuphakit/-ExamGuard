// ==========================================================================
// Exam Guard - Portal Script (portal.js)
// CSP-compliant: No inline scripts, standard event listeners
// ==========================================================================

window.ExamGuardConfig = {
  examTitle: "แบบทดสอบออนไลน์ Google Forms (Exam Guard Protected)",
  examDurationMinutes: 60,    // ระยะเวลาสอบ 60 นาที (ปรับได้)
  maxViolations: 3,           // ละเมิดได้สูงสุด 3 ครั้งก่อนถูกตัดสิทธิ์
  enableCamera: true,         // เปิดใช้งานระบบกล้องเว็บแคม (เหมือน ExtendedForms)
  cameraIntervalMinutes: 3,   // สุ่มถ่ายภาพทุกๆ 3 นาที
  proctorPin: "1234",         // รหัส PIN ครูผู้คุมสอบ (ปลดล็อกหรือเพิ่มเวลา)
  requireStudentInfo: true    // บังคับกรอกชื่อและรหัสนักศึกษาก่อนเริ่มสอบ
};

document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_FORM_URL = "";

  function getTargetFormUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryForm = params.get("form");
    if (queryForm) {
      localStorage.setItem("eg_current_google_form", queryForm);
      return queryForm;
    }

    const saved = localStorage.getItem("eg_current_google_form");
    return saved || DEFAULT_FORM_URL;
  }

  function formatEmbedUrl(rawUrl) {
    if (!rawUrl) return "";
    let url = rawUrl.trim();
    if (url.includes("docs.google.com/forms")) {
      url = url.replace(/[\?&]usp=[^&]+/, "");
      if (!url.includes("embedded=true")) {
        url += (url.includes("?") ? "&" : "?") + "embedded=true";
      }
    }
    return url;
  }

  function loadFormIntoIframe() {
    const targetUrl = formatEmbedUrl(getTargetFormUrl());
    const iframe = document.getElementById("google-form-iframe");
    if (iframe && targetUrl) {
      iframe.src = targetUrl;
    }
  }

  // Proctor Mode Handling: Students do NOT see top-bar
  const urlParams = new URLSearchParams(window.location.search);
  const isProctor = urlParams.get("proctor") === "1" || urlParams.get("teacher") === "1";
  const topBar = document.getElementById("top-bar");

  if (isProctor && topBar) {
    topBar.classList.add("proctor-visible");
  }

  // Hidden Teacher Shortcut: Press Ctrl + Shift + P to toggle proctor toolbar with PIN 1234
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
      e.preventDefault();
      const pin = prompt("🔐 กรุณากรอกรหัส PIN ผู้คุมสอบเพื่อเปิดแผงควบคุม:");
      if (pin === (window.ExamGuardConfig?.proctorPin || "1234")) {
        if (topBar) topBar.classList.toggle("proctor-visible");
      } else if (pin) {
        alert("❌ รหัส PIN ผู้คุมสอบไม่ถูกต้อง");
      }
    }
  });

  // Modals & Buttons
  const btnChangeForm = document.getElementById("btn-change-form");
  const modalChangeForm = document.getElementById("change-form-modal");
  const btnCloseChangeForm = document.getElementById("btn-close-change-form");
  const btnSaveForm = document.getElementById("btn-save-form");
  const inputNewForm = document.getElementById("input-new-form-url");

  const btnOpenShare = document.getElementById("btn-open-share");
  const modalShare = document.getElementById("share-modal");
  const btnCloseShare = document.getElementById("btn-close-share");
  const btnCopyShare = document.getElementById("btn-copy-share");
  const inputShareLink = document.getElementById("share-link-input");

  const btnSnapshots = document.getElementById("btn-view-snapshots");
  const btnExportCsv = document.getElementById("btn-export-csv");
  const btnResetExam = document.getElementById("btn-reset-exam");

  if (btnChangeForm) {
    btnChangeForm.addEventListener("click", () => {
      if (inputNewForm) inputNewForm.value = getTargetFormUrl();
      if (modalChangeForm) modalChangeForm.style.display = "flex";
    });
  }

  if (btnCloseChangeForm) {
    btnCloseChangeForm.addEventListener("click", () => {
      if (modalChangeForm) modalChangeForm.style.display = "none";
    });
  }

  if (btnSaveForm) {
    btnSaveForm.addEventListener("click", () => {
      const input = inputNewForm ? inputNewForm.value.trim() : "";
      if (!input) return alert("กรุณากรอกลิงก์ Google Forms");
      localStorage.setItem("eg_current_google_form", input);
      if (modalChangeForm) modalChangeForm.style.display = "none";
      const u = new URL(window.location.href);
      u.searchParams.set("form", input);
      u.searchParams.set("reset", "1");
      window.location.href = u.href;
    });
  }

  if (btnOpenShare) {
    btnOpenShare.addEventListener("click", () => {
      const currentForm = getTargetFormUrl();
      const url = new URL(window.location.href);
      url.searchParams.set("form", currentForm);
      if (inputShareLink) inputShareLink.value = url.href;
      if (modalShare) modalShare.style.display = "flex";
    });
  }

  if (btnCloseShare) {
    btnCloseShare.addEventListener("click", () => {
      if (modalShare) modalShare.style.display = "none";
    });
  }

  if (btnCopyShare) {
    btnCopyShare.addEventListener("click", () => {
      if (!inputShareLink) return;
      inputShareLink.select();
      navigator.clipboard.writeText(inputShareLink.value).then(() => {
        alert("✅ คัดลอกลิงก์เรียบร้อยแล้ว! นำลิงก์นี้ไปส่งให้นักเรียนได้เลย");
      }).catch(() => {
        alert("ลิงก์: " + inputShareLink.value);
      });
    });
  }

  if (btnSnapshots) {
    btnSnapshots.addEventListener("click", () => {
      if (window.ExamGuardWeb && window.ExamGuardWeb.viewSnapshots) {
        window.ExamGuardWeb.viewSnapshots();
      }
    });
  }

  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => {
      if (window.ExamGuardWeb && window.ExamGuardWeb.exportReportCsv) {
        window.ExamGuardWeb.exportReportCsv();
      }
    });
  }

  if (btnResetExam) {
    btnResetExam.addEventListener("click", () => {
      if (confirm("รีเซ็ตการสอบเพื่อทดสอบใหม่?")) {
        if (window.ExamGuardWeb && window.ExamGuardWeb.resetSession) {
          window.ExamGuardWeb.resetSession();
        }
      }
    });
  }

  // Load form initially
  loadFormIntoIframe();
});
