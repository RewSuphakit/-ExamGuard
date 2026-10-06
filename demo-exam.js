// Demo Exam Logic - CSP compliant
window.ExamGuardConfig = {
  examTitle: "แบบทดสอบวัดความรู้ทั่วไปประจำปีการศึกษา",
  examDurationMinutes: 15,    // ระยะเวลาสอบ (15 นาที)
  maxViolations: 3,           // ละเมิดได้สูงสุด 3 ครั้งก่อนถูกตัดสิทธิ์
  proctorPin: "1234",         // รหัส PIN ครูผู้คุมสอบ (ปลดล็อก / เพิ่มเวลา)
  requireStudentInfo: true    // บังคับกรอกชื่อและรหัสนักศึกษาก่อนเริ่มสอบ
};

document.addEventListener("DOMContentLoaded", () => {
  const btnSubmit = document.getElementById("btn-submit-exam");
  const btnExport = document.getElementById("btn-demo-export");
  const btnReset = document.getElementById("btn-demo-reset");

  if (btnSubmit) {
    btnSubmit.addEventListener("click", () => {
      alert("ยินดีด้วย! คุณได้ส่งข้อสอบเรียบร้อยแล้ว");
    });
  }

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      if (window.ExamGuardWeb && window.ExamGuardWeb.exportReportCsv) {
        window.ExamGuardWeb.exportReportCsv();
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (confirm("ต้องการรีเซ็ตข้อมูลการสอบเพื่อเริ่มทดสอบใหม่ใช่หรือไม่?")) {
        if (window.ExamGuardWeb && window.ExamGuardWeb.resetSession) {
          window.ExamGuardWeb.resetSession();
        }
      }
    });
  }
});
