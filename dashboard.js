// ==========================================================================
// Exam Guard - Dashboard & Control Panel Script (dashboard.js)
// CSP-compliant: No inline scripts, standard event listeners
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  const formUrlInput = document.getElementById("custom-form-url");
  const formFrame = document.getElementById("google-form-frame");
  const toggleTimer = document.getElementById("toggle-timer");
  const inputTimer = document.getElementById("input-timer");
  const rowTimer = document.getElementById("row-timer");
  const toggleViolations = document.getElementById("toggle-violations");
  const inputViolations = document.getElementById("input-violations");
  const rowViolations = document.getElementById("row-violations");
  const btnViolMinus = document.getElementById("btn-viol-minus");
  const btnViolPlus = document.getElementById("btn-viol-plus");
  const toggleAutoSubmit = document.getElementById("toggle-autosubmit");
  const toggleCamera = document.getElementById("toggle-camera");
  const toggleTab = document.getElementById("toggle-tab");
  const toggleCopy = document.getElementById("toggle-copy");
  const toggleFullscreen = document.getElementById("toggle-fullscreen");
  const toggleWatermark = document.getElementById("toggle-watermark");
  const shareMode = document.getElementById("share-mode");
  const btnReloadForm = document.getElementById("btn-reload-form");
  const btnCopyLink = document.getElementById("btn-copy-link");
  const btnShareIcon = document.getElementById("btn-share-icon");
  const btnPreview = document.getElementById("btn-preview");
  const btnResponses = document.getElementById("btn-responses");
  const btnInvite = document.getElementById("btn-invite");
  const copyToast = document.getElementById("copy-toast");

  // Read URL params if opened with ?form=...
  const urlParams = new URLSearchParams(window.location.search);
  const queryForm = urlParams.get("form");
  if (queryForm && formUrlInput) {
    formUrlInput.value = queryForm;
  }

  function reloadFormIframe() {
    if (!formUrlInput || !formFrame) return;
    let raw = formUrlInput.value.trim();
    if (!raw) return;
    // Automatically convert /edit to /viewform because Google Forms editor CANNOT be embedded in iframes
    if (raw.includes("docs.google.com/forms") && raw.includes("/edit")) {
      raw = raw.replace(/\/edit.*$/, "/viewform");
      formUrlInput.value = raw;
    }
    if (raw.includes("docs.google.com/forms") && !raw.includes("embedded=true")) {
      raw += (raw.includes("?") ? "&" : "?") + "embedded=true";
    }
    formFrame.src = raw;
  }

  function adjustViolations(delta) {
    if (!inputViolations) return;
    let val = (parseInt(inputViolations.value, 10) || 3) + delta;
    if (val < 1) val = 1;
    if (val > 10) val = 10;
    inputViolations.value = val;
    updateUI();
  }

  function updateUI() {
    if (toggleTimer && rowTimer && inputTimer) {
      const timerChecked = toggleTimer.checked;
      rowTimer.style.opacity = timerChecked ? "1" : "0.35";
      inputTimer.disabled = !timerChecked;
    }

    if (toggleViolations && rowViolations) {
      const violChecked = toggleViolations.checked;
      rowViolations.style.opacity = violChecked ? "1" : "0.35";
    }
  }

  function generateStudentLink() {
    let formUrl = formUrlInput ? formUrlInput.value.trim() : "";
    if (formUrl.includes("docs.google.com/forms") && formUrl.includes("/edit")) {
      formUrl = formUrl.replace(/\/edit.*$/, "/viewform");
    }
    const timerOn = toggleTimer ? toggleTimer.checked : true;
    const duration = inputTimer ? inputTimer.value : "60";
    const violationsOn = toggleViolations ? toggleViolations.checked : true;
    const maxViolations = inputViolations ? inputViolations.value : "3";
    const autoSubmit = toggleAutoSubmit ? toggleAutoSubmit.checked : true;
    const cameraOn = toggleCamera ? toggleCamera.checked : true;
    const tabOn = toggleTab ? toggleTab.checked : true;
    const copyOn = toggleCopy ? toggleCopy.checked : true;
    const fullscreenOn = toggleFullscreen ? toggleFullscreen.checked : true;
    const watermarkOn = toggleWatermark ? toggleWatermark.checked : true;
    const mode = shareMode ? shareMode.value : "anonymous";

    let base = window.location.href.split("?")[0].replace("dashboard.html", "index.html");
    if (base.startsWith("chrome-extension://")) {
      base = "https://rewsuphakit.github.io/-ExamGuard/index.html";
    }
    const url = new URL(base);

    url.searchParams.set("form", formUrl);
    url.searchParams.set("timer", timerOn ? duration : "0");
    url.searchParams.set("autoSubmit", autoSubmit ? "1" : "0");
    url.searchParams.set("camera", cameraOn ? "1" : "0");
    url.searchParams.set("tab", tabOn ? "1" : "0");
    url.searchParams.set("fullscreen", fullscreenOn ? "1" : "0");
    url.searchParams.set("copy", copyOn ? "1" : "0");
    url.searchParams.set("watermark", watermarkOn ? "1" : "0");
    url.searchParams.set("studentInfo", mode === "restricted" ? "1" : "0");
    url.searchParams.set("violations", violationsOn ? maxViolations : "99");

    return url.href;
  }

  function copyConfiguredLink() {
    const link = generateStudentLink();
    navigator.clipboard.writeText(link).then(() => {
      if (copyToast) {
        copyToast.innerHTML = "✅ คัดลอกลิงก์เรียบร้อย! (นำลิงก์นี้ไปส่งให้นักเรียนเพื่อเปิดระบบป้องกันโดยไม่ต้องลง Extension)";
        copyToast.style.display = "block";
        setTimeout(() => { copyToast.style.display = "none"; }, 4000);
      } else {
        alert("✅ คัดลอกลิงก์ข้อสอบเรียบร้อยแล้ว!\n\nให้นำลิงก์นี้ไปส่งให้นักเรียนเข้าสอบ (ระบบป้องกันจะทำงานทันทีโดยนักเรียนไม่ต้องลง Extension ครับ)");
      }
    }).catch(() => {
      prompt("คัดลอกลิงก์ส่งให้นักเรียน:", link);
    });
  }

  function openPreviewExam() {
    const link = generateStudentLink();
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "OPEN_TAB", url: link }, () => {
        if (chrome.runtime.lastError) {
          window.open(link, "_blank");
        }
      });
    } else {
      window.open(link, "_blank");
    }
  }

  function viewReports() {
    alert("สามารถดูภาพถ่ายและรายงานบันทึกประวัติการละเมิดได้ที่ปุ่มด้านบนของหน้าข้อสอบครับ");
  }

  // Attach Event Listeners (No inline handlers)
  if (btnReloadForm) btnReloadForm.addEventListener("click", reloadFormIframe);
  if (toggleTimer) toggleTimer.addEventListener("change", updateUI);
  if (inputTimer) inputTimer.addEventListener("change", updateUI);
  if (toggleViolations) toggleViolations.addEventListener("change", updateUI);
  if (btnViolMinus) btnViolMinus.addEventListener("click", () => adjustViolations(-1));
  if (btnViolPlus) btnViolPlus.addEventListener("click", () => adjustViolations(1));
  if (btnCopyLink) btnCopyLink.addEventListener("click", copyConfiguredLink);
  if (btnShareIcon) btnShareIcon.addEventListener("click", copyConfiguredLink);
  if (btnPreview) btnPreview.addEventListener("click", openPreviewExam);
  if (btnResponses) btnResponses.addEventListener("click", viewReports);
  if (btnInvite) btnInvite.addEventListener("click", copyConfiguredLink);

  // Initialize
  reloadFormIframe();
  updateUI();
});
