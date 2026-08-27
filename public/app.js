/* =========================================================
   DOM ELEMENTS
========================================================= */

const studentForm = document.getElementById("studentForm");
const message = document.getElementById("message");
const loginCard = document.getElementById("loginCard");
const resultSection = document.getElementById("resultSection");
const resultsBody = document.getElementById("resultsBody");

const captchaCard = document.getElementById("captchaCard");
const captchaActionRow = document.getElementById("captchaActionRow");
const captchaCheckbox = document.getElementById("captchaCheckbox");
const captchaStatus = document.getElementById("captchaStatus");

let isCaptchaRequired = true;
let isCaptchaVerified = false;

/* =========================================================
   APPLY SETTINGS TO DOM
========================================================= */

function applySettingsToDOM(settings) {
  if (!settings) return;

  const instName = settings.institute_name || "معهد النتائج";
  const platName = settings.platform_name || "منصة النتائج الامتحانية";

  document.title = `${instName} | ${platName}`;

  if (document.getElementById("instituteName")) {
    document.getElementById("instituteName").textContent = instName;
  }
  if (document.getElementById("resultInstitute")) {
    document.getElementById("resultInstitute").textContent = instName;
  }

  /* Ministerial Header Titles */
  if (document.getElementById("headerRightTitle")) {
    const rTitle = settings.header_right_title || "جمهورية العراق\nوزارة التربية";
    document.getElementById("headerRightTitle").innerHTML = escapeHtml(rTitle).replaceAll("\n", "<br>");
  }

  if (document.getElementById("headerLeftTitle")) {
    const lTitle = settings.header_left_title || "اللجنة الدائمة للامتحانات العامة";
    document.getElementById("headerLeftTitle").innerHTML = escapeHtml(lTitle).replaceAll("\n", "<br>");
  }

  if (document.getElementById("examTitle")) {
    document.getElementById("examTitle").textContent = settings.exam_title || "نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026";
  }

  if (document.getElementById("resultFooterNote")) {
    document.getElementById("resultFooterNote").textContent = settings.result_footer_note || "🛡️ يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان.";
  }

  if (settings.logo_url) {
    const logo = `<img src="${escapeHtml(settings.logo_url)}" alt="شعار المعهد" />`;
    if (document.getElementById("logoBox")) document.getElementById("logoBox").innerHTML = logo;
    if (document.getElementById("resultLogo")) document.getElementById("resultLogo").innerHTML = logo;
  } else {
    if (document.getElementById("logoBox")) document.getElementById("logoBox").textContent = "🎓";
    if (document.getElementById("resultLogo")) {
      document.getElementById("resultLogo").innerHTML = `
        <svg width="68" height="68" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="46" stroke="#b45309" stroke-width="4" fill="#fef3c7"/>
          <circle cx="50" cy="50" r="38" stroke="#d97706" stroke-width="2" fill="#15803d"/>
          <path d="M50 20 L58 36 L76 36 L62 48 L68 66 L50 54 L32 66 L38 48 L24 36 L42 36 Z" fill="#fef08a"/>
          <text x="50" y="80" text-anchor="middle" font-size="9" font-weight="bold" fill="#78350f">جمهورية العراق</text>
        </svg>
      `;
    }
  }

  /* Captcha Settings */
  if (captchaCard) {
    if (settings.captcha_enabled === 0) {
      isCaptchaRequired = false;
      captchaCard.classList.add("hidden");
    } else {
      isCaptchaRequired = true;
      captchaCard.classList.remove("hidden");
    }
  }

  if (document.getElementById("captchaTitle")) {
    document.getElementById("captchaTitle").textContent = settings.captcha_title || "بوابة اور";
  }

  if (document.getElementById("captchaText")) {
    document.getElementById("captchaText").textContent = settings.captcha_text || "انا احب العراق";
  }

  if (document.getElementById("captchaLogo")) {
    if (settings.captcha_logo_url) {
      document.getElementById("captchaLogo").innerHTML = `<img src="${escapeHtml(settings.captcha_logo_url)}" alt="شعار التحقق" />`;
    } else {
      document.getElementById("captchaLogo").innerHTML = `
        <svg width="34" height="22" viewBox="0 0 40 26" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="13" y="2" width="14" height="4" rx="1" fill="#991B1B"/>
          <rect x="9" y="7" width="22" height="4" rx="1" fill="#B91C1C"/>
          <rect x="5" y="12" width="30" height="4" rx="1" fill="#DC2626"/>
          <rect x="2" y="17" width="36" height="7" rx="1.5" fill="#991B1B"/>
        </svg>
      `;
    }
  }
}

/* =========================================================
   SETTINGS LOADER
========================================================= */

async function loadSettings() {
  try {
    // 1. Instant local render if available
    const cached = localStorage.getItem("platform_settings_cache");
    if (cached) {
      try { applySettingsToDOM(JSON.parse(cached)); } catch (e) {}
    }

    // 2. Fresh fetch from server
    const res = await fetch("/api/public/settings?_t=" + Date.now(), {
      cache: "no-store",
      headers: { "Pragma": "no-cache" }
    });

    if (!res.ok) return;
    const settings = await res.json();

    localStorage.setItem("platform_settings_cache", JSON.stringify(settings));
    applySettingsToDOM(settings);

    if (loginCard) {
      loginCard.style.opacity = "1";
    }

  } catch (error) {
    console.error("Failed to load platform settings:", error);
    if (loginCard) {
      loginCard.style.opacity = "1";
    }
  }
}

/* =========================================================
   LIVE BROADCAST & SYNC
========================================================= */

window.addEventListener("storage", (e) => {
  if (e.key === "settings_updated_time" || e.key === "platform_settings_cache") {
    loadSettings();
  }
});

try {
  const syncChannel = new BroadcastChannel("platform_settings_sync");
  syncChannel.onmessage = () => loadSettings();
} catch (e) {}

/* =========================================================
   CAPTCHA INTERACTION
========================================================= */

if (captchaActionRow && captchaCheckbox) {
  captchaActionRow.addEventListener("click", () => {
    if (isCaptchaVerified) return;

    captchaCheckbox.classList.add("loading");
    if (captchaCard) captchaCard.classList.remove("error");
    if (captchaStatus) captchaStatus.classList.add("hidden");

    setTimeout(() => {
      captchaCheckbox.classList.remove("loading");
      captchaCheckbox.classList.add("verified");
      isCaptchaVerified = true;

      if (captchaStatus) {
        captchaStatus.innerHTML = '<span class="status-success">✓ تم التحقق بنجاح</span>';
        captchaStatus.classList.remove("hidden");
      }
    }, 400);
  });
}

/* =========================================================
   STUDENT LOGIN
========================================================= */

if (studentForm) {
  studentForm.addEventListener("submit", async (event) => {
    if (event) event.preventDefault();

    /* Validate Captcha if enabled */
    if (isCaptchaRequired && !isCaptchaVerified) {
      if (captchaCard) captchaCard.classList.add("error");
      if (captchaStatus) {
        captchaStatus.innerHTML = '<span class="status-error">✕ فشل التحقق. يرجى الضغط على المربع للمتابعة.</span>';
        captchaStatus.classList.remove("hidden");
      }
      return false;
    }

    if (message) {
      message.style.color = "var(--primary)";
      message.textContent = "جاري التحقق من الرقم الامتحاني...";
    }

    const examNumberInput = document.getElementById("examNumber");
    const passwordInput = document.getElementById("password");

    const examNumber = examNumberInput ? examNumberInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value.trim() : "";
    const button = studentForm.querySelector("button[type='submit']");

    if (button) button.disabled = true;

    try {
      const res = await fetch("/api/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam_number: examNumber,
          password: password
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "الرقم الامتحاني أو الرقم السري غير صحيح.");
      }

      renderResult(data);
      if (message) message.textContent = "";

      if (loginCard) loginCard.classList.add("hidden");
      if (resultSection) resultSection.classList.remove("hidden");

      window.scrollTo({ top: 0, behavior: "smooth" });

    } catch (error) {
      if (message) {
        message.style.color = "var(--danger)";
        message.textContent = error.message;
      }
    } finally {
      if (button) button.disabled = false;
    }

    return false;
  });
}

/* =========================================================
   LOGOUT / SEARCH ANOTHER RESULT
========================================================= */

const logoutStudentBtn = document.getElementById("logoutStudent");
if (logoutStudentBtn) {
  logoutStudentBtn.addEventListener("click", () => {
    if (resultSection) resultSection.classList.add("hidden");
    if (loginCard) loginCard.classList.remove("hidden");
    if (studentForm) studentForm.reset();
    if (message) message.textContent = "";

    /* Reset Captcha */
    isCaptchaVerified = false;
    if (captchaCheckbox) {
      captchaCheckbox.classList.remove("verified", "loading");
    }
    if (captchaCard) {
      captchaCard.classList.remove("error");
    }
    if (captchaStatus) {
      captchaStatus.classList.add("hidden");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* =========================================================
   RENDER RESULT (MINISTERIAL CERTIFICATE)
========================================================= */

function renderResult(data) {
  if (!data || !data.student) return;

  const nameEl = document.getElementById("studentName");
  const schoolEl = document.getElementById("studentSchool");
  const govEl = document.getElementById("studentGovernorate");
  const examEl = document.getElementById("studentExam");

  if (nameEl) nameEl.textContent = data.student.full_name;
  if (schoolEl) schoolEl.textContent = data.student.school_name || data.student.stage || "-";
  if (govEl) govEl.textContent = data.student.governorate || data.student.group_name || "-";
  if (examEl) examEl.textContent = data.student.exam_number;

  const totalEl = document.getElementById("studentTotal");
  if (totalEl) totalEl.textContent = data.summary.total;

  const avgEl = document.getElementById("studentAverage");
  if (avgEl) avgEl.textContent = Number(data.summary.average).toFixed(2);

  const statusEl = document.getElementById("studentStatus");
  if (statusEl) {
    statusEl.textContent = data.summary.status;
    statusEl.className = "m-val status-val";
    if (data.summary.status === "ناجح") {
      statusEl.classList.add("pass");
    } else if (data.summary.status === "راسب") {
      statusEl.classList.add("fail");
    }
  }

  if (resultsBody) {
    resultsBody.innerHTML = "";

    if (!data.results || !data.results.length) {
      resultsBody.innerHTML = `
        <tr>
          <td colspan="2" style="text-align: center; color: #6b7280; padding: 24px;">
            لا توجد درجات منشورة لهذا الطالب حتى الآن.
          </td>
        </tr>
      `;
    } else {
      for (const result of data.results) {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td class="td-subject">${escapeHtml(result.subject)}</td>
          <td class="td-grade">${Number(result.grade)}</td>
        `;
        resultsBody.appendChild(row);
      }
    }
  }
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   START
========================================================= */

loadSettings();