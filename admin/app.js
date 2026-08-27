/* =========================================================
   ADMIN DASHBOARD JAVASCRIPT
   Institute Results Management System
========================================================= */

const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");

let studentsCache = [];
let activeStudentResults = null;
let selectedLogoData = "";
let removeLogoFlag = false;

/* =========================================================
   API HELPER
========================================================= */

async function api(url, options = {}) {
  const token = localStorage.getItem("admin_auth_token") || "";
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !url.includes("/api/admin/login")) {
      localStorage.removeItem("admin_auth_token");
      showLogin();
    }
    throw new Error(data.error || "حدث خطأ أثناء الاتصال بالخادم.");
  }

  return data;
}

/* =========================================================
   TOAST NOTIFICATIONS
========================================================= */

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* Copy text to clipboard helper */
async function copyText(text, successMsg = "تم النسخ إلى الحافظة بنجاح ✅") {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(successMsg, "success");
  } catch (err) {
    showToast("تعذر النسخ تلقائياً.", "error");
  }
}

/* =========================================================
   SESSION & AUTH
========================================================= */

async function checkSession() {
  try {
    const data = await api("/api/admin/me");
    if (data.isAdmin) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
  loadAll();
}

/* Login Form Submit */
document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("loginMessage");
  const button = document.getElementById("loginBtn");
  const passInput = document.getElementById("adminPassword");

  message.style.color = "var(--primary)";
  message.textContent = "جاري التحقق من كلمة المرور...";
  button.disabled = true;

  try {
    const res = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: passInput.value })
    });

    if (res.token) {
      localStorage.setItem("admin_auth_token", res.token);
    }

    message.textContent = "";
    passInput.value = "";
    showDashboard();
    showToast("مرحباً بك في لوحة الإدارة 🎓", "success");
  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

/* Toggle Password Visibility */
document.getElementById("toggleLoginPass").addEventListener("click", () => {
  const passInput = document.getElementById("adminPassword");
  passInput.type = passInput.type === "password" ? "text" : "password";
});

/* Logout Handler */
document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (!confirm("هل أنت متأكد من رغبتك في تسجيل الخروج؟")) return;

  try {
    await api("/api/admin/logout", { method: "POST" });
    localStorage.removeItem("admin_auth_token");
    showLogin();
    showToast("تم تسجيل الخروج بنجاح.", "info");
  } catch (error) {
    showToast(error.message, "error");
  }
});

/* =========================================================
   TABS NAVIGATION
========================================================= */

const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    const targetTab = button.getAttribute("data-tab");

    tabButtons.forEach(btn => btn.classList.remove("active"));
    tabContents.forEach(content => content.classList.remove("active"));

    button.classList.add("active");
    const targetElem = document.getElementById(targetTab);
    if (targetElem) targetElem.classList.add("active");
  });
});

/* =========================================================
   LOAD ALL DATA
========================================================= */

async function loadAll() {
  try {
    await Promise.all([
      loadDashboard(),
      loadStudents(),
      loadSettings()
    ]);
  } catch (error) {
    console.error("Load all error:", error);
  }
}

/* =========================================================
   DASHBOARD STATS
========================================================= */

async function loadDashboard() {
  try {
    const data = await api("/api/admin/dashboard");
    document.getElementById("studentsCount").textContent = data.students || 0;
    document.getElementById("resultsCount").textContent = data.results || 0;
    document.getElementById("passedCount").textContent = data.passed || 0;
    document.getElementById("failedCount").textContent = data.failed || 0;
    document.getElementById("pendingCount").textContent = data.pending || 0;
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

/* =========================================================
   STUDENTS MANAGEMENT
========================================================= */

/* Helper: Generate random student credentials */
document.getElementById("genExamNum").addEventListener("click", () => {
  const currentYear = new Date().getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  document.getElementById("examNumber").value = `${currentYear}${randomSuffix}`;
});

document.getElementById("genPass").addEventListener("click", () => {
  const randomPass = Math.floor(1000 + Math.random() * 9000);
  document.getElementById("studentPassword").value = randomPass.toString();
});

async function loadStudents() {
  const searchInput = document.getElementById("searchStudents");
  const search = searchInput ? searchInput.value.trim() : "";

  try {
    const data = await api(`/api/admin/students?search=${encodeURIComponent(search)}`);
    studentsCache = data;

    const tbody = document.getElementById("studentsBody");
    const emptyState = document.getElementById("emptyStudents");
    const resultSelect = document.getElementById("resultStudent");

    tbody.innerHTML = "";
    resultSelect.innerHTML = `<option value="">-- اختر الطالب المراد رصد درجات له --</option>`;

    if (!data.length) {
      emptyState.classList.remove("hidden");
    } else {
      emptyState.classList.add("hidden");
    }

    for (const student of data) {
      // Create student table row
      const row = document.createElement("tr");

      let statusBadge = "";
      if (student.results_count === 0) {
        statusBadge = `<span class="status-pill status-pending">⏳ بدون نتائج</span>`;
      } else if (student.average >= 50) {
        statusBadge = `<span class="status-pill status-pass">🏆 ناجح (${student.average}%)</span>`;
      } else {
        statusBadge = `<span class="status-pill status-fail">⚠️ راسب (${student.average}%)</span>`;
      }

      row.innerHTML = `
        <td>
          <div class="student-col">
            <span class="student-title">${escapeHtml(student.full_name)}</span>
            <span class="student-date">مسجل: ${formatDate(student.created_at)}</span>
          </div>
        </td>
        <td>
          <span class="badge-code">${escapeHtml(student.exam_number)}</span>
          ${student.plain_password ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">🔑 سري: <strong style="color: var(--text-main);">${escapeHtml(student.plain_password)}</strong></div>` : ""}
        </td>
        <td>
          <div>${escapeHtml(student.stage || "-")}</div>
          <small style="color: var(--text-muted);">${escapeHtml(student.group_name || "-")}</small>
        </td>
        <td>
          <strong>${student.results_count} مواد</strong>
          ${student.results_count > 0 ? `<div style="font-size: 11px; color: var(--text-muted);">المجموع: ${student.total}/${student.max_total}</div>` : ""}
        </td>
        <td>
          ${statusBadge}
        </td>
        <td>
          <div class="actions-cell">
            <button class="table-action-btn action-view" onclick="openStudentResults(${student.id})" title="عرض وتعديل الدرجات">
              📊 الدرجات (${student.results_count})
            </button>
            <button class="table-action-btn action-copy" onclick="copyStudentCredentials(${student.id})" title="نسخ كليشة الدخول للواتساب">
              📋 نسخ الدخول
            </button>
            <button class="table-action-btn action-edit" onclick="openEditStudent(${student.id})" title="تعديل البيانات">
              ✏️ تعديل
            </button>
            <button class="table-action-btn action-del" onclick="deleteStudent(${student.id})" title="حذف الطالب">
              🗑️
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(row);

      // Populate Select for adding grade
      const option = document.createElement("option");
      option.value = student.id;
      option.textContent = `${student.full_name} | رقم امتحاني: ${student.exam_number} (${student.stage || ""})`;
      resultSelect.appendChild(option);
    }
  } catch (error) {
    console.error("Error loading students:", error);
  }
}

/* Debounced search */
let searchDebounceTimer;
document.getElementById("searchStudents").addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadStudents, 250);
});

/* Add Student Form */
document.getElementById("studentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const message = document.getElementById("studentMessage");
  const button = form.querySelector("button[type='submit']");
  const quickShareBox = document.getElementById("quickShareBox");
  const quickShareText = document.getElementById("quickShareText");
  const copyShareBtn = document.getElementById("copyShareBtn");

  const fullName = document.getElementById("fullName").value.trim();
  const examNumber = document.getElementById("examNumber").value.trim();
  const password = document.getElementById("studentPassword").value.trim();
  const stage = document.getElementById("stage").value.trim();
  const groupName = document.getElementById("groupName").value.trim();

  button.disabled = true;
  message.style.color = "var(--text-muted)";
  message.textContent = "جاري حفظ بيانات الطالب...";

  try {
    const res = await api("/api/admin/students", {
      method: "POST",
      body: JSON.stringify({
        full_name: fullName,
        exam_number: examNumber,
        password: password,
        stage: stage,
        group_name: groupName
      })
    });

    form.reset();
    message.style.color = "var(--success)";
    message.textContent = "✓ تم تسجيل الطالب بنجاح!";
    showToast(`تمت إضافة الطالب ${fullName} بنجاح ✅`, "success");

    // Build share message
    const platformUrl = window.location.origin;
    const shareMessage = `🎓 عزيزي الطالب/ة: ${fullName}\nتم تسجيلك بنجاح في منصة النتائج الامتحانية.\n\n🔗 رابط المنصة: ${platformUrl}\n📌 الرقم الامتحاني: ${examNumber}\n🔑 الرقم السري: ${password}\n\nمع تمنياتنا لكم بالموفقية والنجاح ✨`;

    quickShareText.textContent = shareMessage;
    quickShareBox.classList.remove("hidden");

    copyShareBtn.onclick = () => {
      copyText(shareMessage, "تم نسخ كليشة الدخول لإرسالها للطالب عبر الواتساب ✅");
    };

    await loadStudents();
    await loadDashboard();

    setTimeout(() => {
      message.textContent = "";
    }, 4000);

  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

/* Copy student credentials from table */
function copyStudentCredentials(studentId) {
  const student = studentsCache.find(s => s.id === studentId);
  if (!student) return;

  const platformUrl = window.location.origin;
  const pass = student.plain_password || "••••";
  const school = student.school_name || student.stage;
  const gov = student.governorate || student.group_name;

  let text = `🎓 عزيزي الطالب/ة: ${student.full_name}\nتم تسجيلك في منظومة النتائج الرسمية.\n\n`;
  text += `🔗 رابط المنصة: ${platformUrl}\n`;
  text += `📌 الرقم الامتحاني: ${student.exam_number}\n`;
  text += `🔑 الرقم السري: ${pass}\n`;
  if (school) text += `🏫 المدرسة: ${school}\n`;
  if (gov) text += `📍 المحافظة: ${gov}\n`;
  text += `\nمع تمنياتنا لكم بالنجاح والتوفيق ✨`;

  copyText(text, `تم نسخ بيانات الدخول للطالب ${student.full_name} (مع الرقم السري) ✅`);
}

/* Delete Student */
async function deleteStudent(studentId) {
  const student = studentsCache.find(s => s.id === studentId);
  if (!student) return;

  const ok = confirm(`هل أنت متأكد من حذف الطالب "${student.full_name}"؟\nسيتم مسح كافة درجاته من النظام.`);
  if (!ok) return;

  try {
    await api(`/api/admin/students/${studentId}`, { method: "DELETE" });
    showToast(`تم حذف الطالب "${student.full_name}" بنجاح.`, "info");
    await loadStudents();
    await loadDashboard();
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* Edit Student Modal */
function openEditStudent(studentId) {
  const student = studentsCache.find(s => s.id === studentId);
  if (!student) return;

  document.getElementById("editStudentId").value = student.id;
  document.getElementById("editFullName").value = student.full_name;
  document.getElementById("editExamNumber").value = student.exam_number;
  document.getElementById("editPassword").value = "";
  document.getElementById("editStage").value = student.school_name || student.stage || "";
  document.getElementById("editGroup").value = student.governorate || student.group_name || "";
  document.getElementById("editMessage").textContent = "";

  document.getElementById("editModal").classList.remove("hidden");
}

document.getElementById("closeEditModal").addEventListener("click", () => {
  document.getElementById("editModal").classList.add("hidden");
});

document.getElementById("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = Number(document.getElementById("editStudentId").value);
  const fullName = document.getElementById("editFullName").value.trim();
  const examNumber = document.getElementById("editExamNumber").value.trim();
  const password = document.getElementById("editPassword").value.trim();
  const stage = document.getElementById("editStage").value.trim();
  const groupName = document.getElementById("editGroup").value.trim();

  const message = document.getElementById("editMessage");

  try {
    await api(`/api/admin/students/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        full_name: fullName,
        exam_number: examNumber,
        password: password,
        school_name: stage,
        governorate: groupName,
        stage: stage,
        group_name: groupName
      })
    });

    showToast("تم تحديث بيانات الطالب بنجاح ✅", "success");
    document.getElementById("editModal").classList.add("hidden");
    await loadStudents();
  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
  }
});

/* =========================================================
   RESULTS & GRADES MANAGEMENT
========================================================= */

/* Render 10 grade rows dynamically */
const multipleGradesContainer = document.getElementById("multipleGradesContainer");
if (multipleGradesContainer) {
  for (let i = 1; i <= 10; i++) {
    multipleGradesContainer.innerHTML += `
      <div class="form-row three-cols" style="align-items: end;">
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 11px;">المادة ${i}</label>
          <input id="subject_${i}" placeholder="اسم المادة" list="subjectsList">
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 11px;">الدرجة</label>
          <input id="grade_${i}" type="number" min="0" step="0.5" placeholder="مثال: 85">
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 11px;">الدرجة العظمى</label>
          <input id="maxGrade_${i}" type="number" min="1" step="0.5" value="100">
        </div>
      </div>
    `;
  }
}

/* Add Grades from Tab 2 */
document.getElementById("resultForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const message = document.getElementById("resultMessage");
  const button = form.querySelector("button[type='submit']");

  const studentId = Number(document.getElementById("resultStudent").value);

  if (!studentId) {
    message.style.color = "var(--danger)";
    message.textContent = "يرجى اختيار طالب أولاً.";
    return;
  }

  // Gather all valid rows
  const payload = [];
  for (let i = 1; i <= 10; i++) {
    const subject = document.getElementById(`subject_${i}`).value.trim();
    const gradeVal = document.getElementById(`grade_${i}`).value;
    const maxGradeVal = document.getElementById(`maxGrade_${i}`).value;

    if (subject && gradeVal !== "") {
      payload.push({
        student_id: studentId,
        subject: subject,
        grade: Number(gradeVal),
        max_grade: Number(maxGradeVal)
      });
    }
  }

  if (payload.length === 0) {
    message.style.color = "var(--danger)";
    message.textContent = "يرجى إدخال مادة واحدة على الأقل مع الدرجة.";
    return;
  }

  button.disabled = true;
  message.style.color = "var(--text-muted)";
  message.textContent = "جاري رصد الدرجات...";

  try {
    // Process them sequentially or concurrently
    for (const data of payload) {
      await api("/api/admin/results", {
        method: "POST",
        body: JSON.stringify(data)
      });
    }

    // Clear inputs
    for (let i = 1; i <= 10; i++) {
      document.getElementById(`subject_${i}`).value = "";
      document.getElementById(`grade_${i}`).value = "";
      document.getElementById(`maxGrade_${i}`).value = 100;
    }

    message.style.color = "var(--success)";
    message.textContent = `✓ تم رصد ${payload.length} مادة بنجاح!`;
    showToast(`تمت إضافة ${payload.length} درجات بنجاح ✅`, "success");

    await loadStudents();
    await loadDashboard();

    setTimeout(() => {
      message.textContent = "";
    }, 3500);

  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

/* Open Student Results Modal */
async function openStudentResults(studentId) {
  try {
    const data = await api(`/api/admin/results/${studentId}`);
    activeStudentResults = data;

    // Set banner info
    document.getElementById("modalStudentName").textContent = `نتائج الطالب: ${data.student.full_name}`;
    document.getElementById("modalStudentExam").textContent = `الرقم الامتحاني: ${data.student.exam_number}`;
    document.getElementById("modalStudentStage").textContent = `المدرسة: ${data.student.school_name || data.student.stage || "-"}`;
    document.getElementById("modalStudentGroup").textContent = `المحافظة: ${data.student.governorate || data.student.group_name || "-"}`;

    // Summary metrics
    document.getElementById("modalTotalGrade").textContent = `${data.summary.total} / ${data.summary.max_total}`;
    document.getElementById("modalAverage").textContent = `${data.summary.average}%`;

    const statusBadge = document.getElementById("modalStatusBadge");
    statusBadge.textContent = data.summary.status;
    statusBadge.className = "status-badge-lg";

    if (data.summary.status === "ناجح") {
      statusBadge.classList.add("status-pass");
    } else if (data.summary.status === "راسب") {
      statusBadge.classList.add("status-fail");
    } else {
      statusBadge.classList.add("status-pending");
    }

    renderModalResultsList(data.results, studentId);

    // Setup clear all button
    document.getElementById("clearAllGradesBtn").onclick = () => clearAllStudentGrades(studentId);

    // Setup copy report button
    document.getElementById("copyReportBtn").onclick = () => copyStudentReport(data);

    // Setup print button
    document.getElementById("printReportBtn").onclick = () => window.print();

    // Show modal
    document.getElementById("resultsModal").classList.remove("hidden");

  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderModalResultsList(results, studentId) {
  const container = document.getElementById("modalResultsList");
  container.innerHTML = "";

  if (!results.length) {
    container.innerHTML = `<div class="empty-state" style="padding: 20px;"><p>لا توجد درجات مرصودة لهذا الطالب حتى الآن.</p></div>`;
    return;
  }

  for (const item of results) {
    const div = document.createElement("div");
    div.className = "modal-result-item";
    const percentage = item.max_grade > 0 ? ((item.grade / item.max_grade) * 100).toFixed(1) : 0;
    const isPass = percentage >= 50;

    div.innerHTML = `
      <div class="result-item-info">
        <span class="result-item-title">${escapeHtml(item.subject)}</span>
        <span class="result-item-grade" style="${isPass ? '' : 'color: var(--danger); background: var(--danger-light);'}">
          ${item.grade} / ${item.max_grade} (${percentage}%)
        </span>
      </div>
      <button class="modal-delete-btn" onclick="deleteModalGrade(${item.id}, ${studentId})">
        🗑️ حذف
      </button>
    `;
    container.appendChild(div);
  }
}

/* Add grade inside modal */
document.getElementById("modalAddGradeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeStudentResults) return;

  const studentId = activeStudentResults.student.id;
  const subject = document.getElementById("modalSubject").value.trim();
  const grade = Number(document.getElementById("modalGrade").value);
  const maxGrade = Number(document.getElementById("modalMaxGrade").value);

  try {
    await api("/api/admin/results", {
      method: "POST",
      body: JSON.stringify({
        student_id: studentId,
        subject: subject,
        grade: grade,
        max_grade: maxGrade
      })
    });

    document.getElementById("modalSubject").value = "";
    document.getElementById("modalGrade").value = "";
    document.getElementById("modalMaxGrade").value = 100;

    showToast(`تمت إضافة (${subject}) بنجاح ✅`, "success");

    // Refresh modal and dashboard
    await openStudentResults(studentId);
    await loadStudents();
    await loadDashboard();

  } catch (error) {
    showToast(error.message, "error");
  }
});

/* Delete single grade inside modal */
async function deleteModalGrade(resultId, studentId) {
  if (!confirm("هل تريد حذف درجة هذه المادة؟")) return;

  try {
    await api(`/api/admin/results/${resultId}`, { method: "DELETE" });
    showToast("تم حذف الدرجة بنجاح.", "info");
    await openStudentResults(studentId);
    await loadStudents();
    await loadDashboard();
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* Clear all grades for student */
async function clearAllStudentGrades(studentId) {
  if (!confirm("تحذير: هل أنت متأكد من مسح جميع الدرجات المرصودة لهذا الطالب؟")) return;

  try {
    await api(`/api/admin/results/student/${studentId}`, { method: "DELETE" });
    showToast("تم مسح جميع درجات الطالب.", "info");
    await openStudentResults(studentId);
    await loadStudents();
    await loadDashboard();
  } catch (error) {
    showToast(error.message, "error");
  }
}

/* Copy formatted report card for WhatsApp */
function copyStudentReport(data) {
  const student = data.student;
  const summary = data.summary;
  const results = data.results;

  let report = `📊 *كشف الدرجات الرسمي*\n`;
  report += `👤 الطالب: ${student.full_name}\n`;
  report += `📌 الرقم الامتحاني: ${student.exam_number}\n`;
  if (student.school_name || student.stage) report += `🏫 المدرسة: ${student.school_name || student.stage}\n`;
  if (student.governorate || student.group_name) report += `📍 المحافظة: ${student.governorate || student.group_name}\n`;
  report += `----------------------------\n`;

  if (results.length === 0) {
    report += `لا توجد نتائج منشورة حالياً.\n`;
  } else {
    results.forEach((r, idx) => {
      report += `${idx + 1}. ${r.subject}: ${r.grade} من ${r.max_grade}\n`;
    });
    report += `----------------------------\n`;
    report += `📈 المجموع: ${summary.total} / ${summary.max_total}\n`;
    report += `🎯 المعدل: ${summary.average}%\n`;
    report += `🏆 النتيجة النهائية: *${summary.status}*\n`;
  }

  report += `----------------------------\n`;
  report += `مع تمنياتنا لجميع الطلبة بالتفوق والنجاح 🎓`;

  copyText(report, "تم نسخ كشف الدرجات الكامل لإرساله عبر الواتساب ✅");
}

/* Close Results Modal */
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("resultsModal").classList.add("hidden");
});

/* Close modals on background click */
window.addEventListener("click", (event) => {
  if (event.target.id === "resultsModal") {
    document.getElementById("resultsModal").classList.add("hidden");
  }
  if (event.target.id === "editModal") {
    document.getElementById("editModal").classList.add("hidden");
  }
});

let selectedCaptchaLogoData = "";
let removeCaptchaLogoFlag = false;

async function loadSettings() {
  try {
    const data = await api("/api/admin/settings");

    document.getElementById("instituteName").value = data.institute_name || "";
    document.getElementById("platformName").value = data.platform_name || "";

    document.getElementById("headerInstitute").textContent = data.institute_name || "معهد النتائج";
    document.getElementById("headerPlatform").textContent = data.platform_name || "منصة إدارة النتائج الامتحانية";

    renderLogo(data.logo_url);

    /* Captcha Settings */
    if (document.getElementById("captchaEnabled")) {
      document.getElementById("captchaEnabled").checked = (data.captcha_enabled !== 0);
    }
    if (document.getElementById("captchaText")) {
      document.getElementById("captchaText").value = data.captcha_text || "انا احب العراق";
    }
    if (document.getElementById("captchaTitle")) {
      document.getElementById("captchaTitle").value = data.captcha_title || "بوابة اور";
    }
    renderCaptchaLogo(data.captcha_logo_url);

    /* Ministerial Header Settings */
    if (document.getElementById("headerRightTitle")) {
      document.getElementById("headerRightTitle").value = data.header_right_title || "جمهورية العراق\nوزارة التربية";
    }
    if (document.getElementById("headerLeftTitle")) {
      document.getElementById("headerLeftTitle").value = data.header_left_title || "اللجنة الدائمة للامتحانات العامة";
    }
    if (document.getElementById("examTitle")) {
      document.getElementById("examTitle").value = data.exam_title || "نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026";
    }
    if (document.getElementById("resultFooterNote")) {
      document.getElementById("resultFooterNote").value = data.result_footer_note || "🛡️ يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان.";
    }

    // Update public url text in info card
    document.getElementById("publicUrlText").textContent = window.location.origin;
    document.getElementById("adminUrlText").textContent = window.location.origin + "/admin";

  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

function renderLogo(url) {
  const preview = document.getElementById("logoPreview");
  const headerLogo = document.getElementById("headerLogo");

  if (url) {
    const imgHtml = `<img src="${escapeHtml(url)}" alt="الشعار">`;
    preview.innerHTML = imgHtml;
    headerLogo.innerHTML = imgHtml;
  } else {
    preview.textContent = "🎓";
    headerLogo.textContent = "🎓";
  }
}

function renderCaptchaLogo(url) {
  const preview = document.getElementById("captchaLogoPreview");
  if (!preview) return;

  if (url) {
    preview.innerHTML = `<img src="${escapeHtml(url)}" style="max-height:100%; max-width:100%; object-fit:contain;" alt="شعار التحقق">`;
  } else {
    preview.innerHTML = "🏛️";
  }
}

/* Logo File Input */
document.getElementById("logoFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
    alert("يرجى اختيار صورة بصيغة PNG أو JPG أو WEBP أو SVG.");
    event.target.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert("حجم الصورة يجب أن لا يتجاوز 5 ميجابايت.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectedLogoData = reader.result;
    removeLogoFlag = false;
    renderLogo(selectedLogoData);
    showToast("تم اختيار الشعار. اضغط 'حفظ التغييرات' لاعتماده.", "info");
  };
  reader.readAsDataURL(file);
});

/* Remove Logo */
document.getElementById("removeLogo").addEventListener("click", () => {
  selectedLogoData = "";
  removeLogoFlag = true;
  document.getElementById("logoFile").value = "";
  renderLogo("");
  showToast("تمت إزالة الشعار. اضغط 'حفظ التغييرات' لتأكيد الحذف.", "info");
});

/* Captcha Logo File Input */
const captchaLogoFileInput = document.getElementById("captchaLogoFile");
if (captchaLogoFileInput) {
  captchaLogoFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
      alert("يرجى اختيار صورة بصيغة PNG أو JPG أو WEBP أو SVG.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      selectedCaptchaLogoData = reader.result;
      removeCaptchaLogoFlag = false;
      renderCaptchaLogo(selectedCaptchaLogoData);
      showToast("تم اختيار شعار التحقق المصغر. اضغط 'حفظ التغييرات' لاعتماده.", "info");
    };
    reader.readAsDataURL(file);
  });
}

/* Remove Captcha Logo */
const removeCaptchaLogoBtn = document.getElementById("removeCaptchaLogo");
if (removeCaptchaLogoBtn) {
  removeCaptchaLogoBtn.addEventListener("click", () => {
    selectedCaptchaLogoData = "";
    removeCaptchaLogoFlag = true;
    if (captchaLogoFileInput) captchaLogoFileInput.value = "";
    renderCaptchaLogo("");
    showToast("تمت إزالة شعار التحقق والعودة للافتراضي.", "info");
  });
}

/* Save Settings Form */
document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("settingsMessage");
  const button = event.target.querySelector(".save-settings-btn");

  const instituteName = document.getElementById("instituteName").value.trim();
  const platformName = document.getElementById("platformName").value.trim();
  const captchaEnabled = document.getElementById("captchaEnabled") ? document.getElementById("captchaEnabled").checked : true;
  const captchaText = document.getElementById("captchaText") ? document.getElementById("captchaText").value.trim() : "انا احب العراق";
  const captchaTitle = document.getElementById("captchaTitle") ? document.getElementById("captchaTitle").value.trim() : "بوابة اور";

  const headerRightTitle = document.getElementById("headerRightTitle") ? document.getElementById("headerRightTitle").value.trim() : "جمهورية العراق\nوزارة التربية";
  const headerLeftTitle = document.getElementById("headerLeftTitle") ? document.getElementById("headerLeftTitle").value.trim() : "اللجنة الدائمة للامتحانات العامة";
  const examTitle = document.getElementById("examTitle") ? document.getElementById("examTitle").value.trim() : "نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026";
  const resultFooterNote = document.getElementById("resultFooterNote") ? document.getElementById("resultFooterNote").value.trim() : "🛡️ يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان.";

  button.disabled = true;
  message.style.color = "var(--text-muted)";
  message.textContent = "جاري حفظ الإعدادات...";

  try {
    const data = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        institute_name: instituteName,
        platform_name: platformName,
        logo_data: selectedLogoData,
        remove_logo: removeLogoFlag,
        captcha_enabled: captchaEnabled,
        captcha_text: captchaText,
        captcha_title: captchaTitle,
        captcha_logo_data: selectedCaptchaLogoData,
        remove_captcha_logo: removeCaptchaLogoFlag,
        header_right_title: headerRightTitle,
        header_left_title: headerLeftTitle,
        exam_title: examTitle,
        result_footer_note: resultFooterNote
      })
    });

    selectedLogoData = "";
    removeLogoFlag = false;
    selectedCaptchaLogoData = "";
    removeCaptchaLogoFlag = false;

    renderLogo(data.settings.logo_url);
    renderCaptchaLogo(data.settings.captcha_logo_url);
    document.getElementById("headerInstitute").textContent = data.settings.institute_name;
    document.getElementById("headerPlatform").textContent = data.settings.platform_name || "منصة إدارة النتائج الامتحانية";

    /* Instant Broadcast to other open tabs */
    try {
      localStorage.setItem("settings_updated_time", Date.now().toString());
      new BroadcastChannel("platform_settings_sync").postMessage({ updated: true });
    } catch (e) {}

    message.style.color = "var(--success)";
    message.textContent = "✓ تم حفظ الإعدادات ونموذج النتيجة بنجاح!";
    showToast("تم تحديث إعدادات المنصة ونموذج الشهادة بنجاح ✅", "success");

    setTimeout(() => {
      message.textContent = "";
    }, 4000);

  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

/* =========================================================
   UTILITIES
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ar-EG", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return dateStr;
  }
}

/* =========================================================
   INITIALIZE
========================================================= */

checkSession();