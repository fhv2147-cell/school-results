import "dotenv/config";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { createClient } from "@libsql/client";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error("❌ تأكد من ADMIN_PASSWORD و SESSION_SECRET داخل .env");
  process.exit(1);
}

/* =========================
   DIRECTORIES
========================= */

const publicDir = path.join(__dirname, "public");
const adminDir = path.join(__dirname, "admin");
const uploadsDir = path.join(publicDir, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/* =========================
   DATABASE INITIALIZATION
========================= */

let dbPath = path.join(__dirname, "results.db");
if (process.env.PROJECT_DOMAIN) {
  const glitchDataDir = path.join(__dirname, ".data");
  if (!fs.existsSync(glitchDataDir)) { fs.mkdirSync(glitchDataDir, { recursive: true }); }
  dbPath = path.join(glitchDataDir, "results.db");
} else if (process.env.FLY_APP_NAME) {
  dbPath = "/data/results.db";
} else if (process.env.DB_PATH) {
  dbPath = process.env.DB_PATH;
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || ("file:" + dbPath),
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function initDB() {
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA foreign_keys = ON");

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      institute_name TEXT NOT NULL DEFAULT 'معهد النتائج',
      platform_name TEXT NOT NULL DEFAULT 'منصة النتائج الامتحانية',
      logo_url TEXT DEFAULT '',
      primary_color TEXT DEFAULT '#111827'
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_number TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plain_password TEXT DEFAULT '',
      full_name TEXT NOT NULL,
      stage TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      grade REAL NOT NULL,
      max_grade REAL NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );
  `);

  /* Migration: Ensure columns exist */
  try {
    const settingsColsRes = await db.execute("PRAGMA table_info(settings)");
    const settingsCols = settingsColsRes.rows;
    if (!settingsCols.some(col => col.name === "platform_name")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN platform_name TEXT DEFAULT 'منصة النتائج الامتحانية'");
    }
    if (!settingsCols.some(col => col.name === "captcha_enabled")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN captcha_enabled INTEGER DEFAULT 1");
    }
    if (!settingsCols.some(col => col.name === "captcha_title")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN captcha_title TEXT DEFAULT 'بوابة اور'");
    }
    if (!settingsCols.some(col => col.name === "captcha_text")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN captcha_text TEXT DEFAULT 'انا احب العراق'");
    }
    if (!settingsCols.some(col => col.name === "captcha_logo_url")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN captcha_logo_url TEXT DEFAULT ''");
    }
    if (!settingsCols.some(col => col.name === "header_right_title")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN header_right_title TEXT DEFAULT 'جمهورية العراق\nوزارة التربية'");
    }
    if (!settingsCols.some(col => col.name === "header_left_title")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN header_left_title TEXT DEFAULT 'اللجنة الدائمة للامتحانات العامة'");
    }
    if (!settingsCols.some(col => col.name === "exam_title")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN exam_title TEXT DEFAULT 'نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026'");
    }
    if (!settingsCols.some(col => col.name === "result_footer_note")) {
      await db.executeMultiple("ALTER TABLE settings ADD COLUMN result_footer_note TEXT DEFAULT 'يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان.'");
    }

    const studentColsRes = await db.execute("PRAGMA table_info(students)");
    const studentCols = studentColsRes.rows;
    if (!studentCols.some(col => col.name === "plain_password")) {
      await db.executeMultiple("ALTER TABLE students ADD COLUMN plain_password TEXT DEFAULT ''");
    }
    if (!studentCols.some(col => col.name === "school_name")) {
      await db.executeMultiple("ALTER TABLE students ADD COLUMN school_name TEXT DEFAULT ''");
    }
    if (!studentCols.some(col => col.name === "governorate")) {
      await db.executeMultiple("ALTER TABLE students ADD COLUMN governorate TEXT DEFAULT ''");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

  /* Ensure default settings row exists */
  const settingsExists = (await db.execute({ sql: "SELECT id FROM settings WHERE id = 1", args: [] })).rows[0];
  if (!settingsExists) {
    await db.execute({
      sql: `
        INSERT INTO settings (id, institute_name, platform_name, logo_url, primary_color)
        VALUES (1, ?, ?, '', '#111827')
      `,
      args: [
        process.env.INSTITUTE_NAME || "معهد النتائج",
        process.env.PLATFORM_NAME || "منصة النتائج الامتحانية"
      ]
    });
  }
}

await initDB();

/* =========================
   MIDDLEWARES
========================= */

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

/* Disable caching for all API responses so updates appear immediately */
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(
  session({
    name: "results_admin_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
  })
);

/* =========================
   RATE LIMITERS
========================= */

const studentLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً. يرجى الانتظار والمحاولة لاحقاً." }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "محاولات تسجيل دخول كثيرة. يرجى المحاولة بعد 15 دقيقة." }
});

/* =========================
   HELPERS
========================= */

function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "جلسة الإدارة منتهية أو غير مصرح." });
  }
  next();
}

async function getSettings() {
  const row = (await db.execute({
    sql: `
      SELECT
        institute_name,
        platform_name,
        logo_url,
        primary_color,
        captcha_enabled,
        captcha_title,
        captcha_text,
        captcha_logo_url,
        header_right_title,
        header_left_title,
        exam_title,
        result_footer_note
      FROM settings
      WHERE id = 1
    `,
    args: []
  })).rows[0];

  return row || {
    institute_name: "معهد النتائج",
    platform_name: "منصة النتائج الامتحانية",
    logo_url: "",
    primary_color: "#111827",
    captcha_enabled: 1,
    captcha_title: "بوابة اور",
    captcha_text: "انا احب العراق",
    captcha_logo_url: "",
    header_right_title: "جمهورية العراق\nوزارة التربية",
    header_left_title: "اللجنة الدائمة للامتحانات العامة",
    exam_title: "نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026",
    result_footer_note: "يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان."
  };
}

async function getStudentStats(studentId) {
  const results = (await db.execute({
    sql: `
      SELECT id, subject, grade, max_grade
      FROM results
      WHERE student_id = ?
      ORDER BY id ASC
    `,
    args: [studentId]
  })).rows;

  const total = results.reduce((sum, item) => sum + Number(item.grade || 0), 0);
  const maxTotal = results.reduce((sum, item) => sum + Number(item.max_grade || 100), 0);
  const average = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const status = results.length === 0 ? "بانتظار النتائج" : (average >= 50 ? "ناجح" : "راسب");

  return {
    results,
    count: results.length,
    total: Number(total.toFixed(2)),
    max_total: Number(maxTotal.toFixed(2)),
    average: Number(average.toFixed(2)),
    status
  };
}

/* =========================
   PUBLIC ROUTES
========================= */

app.get("/api/public/settings", async (req, res) => {
  res.json(await getSettings());
});

/* Student Login & Results */
app.post("/api/student/login", studentLoginLimiter, async (req, res) => {
  try {
    const examNumber = cleanText(req.body.exam_number, 100);
    const password = String(req.body.password ?? "").trim();

    if (!examNumber || !password) {
      return res.status(400).json({ error: "يرجى إدخال الرقم الامتحاني والرقم السري." });
    }

    const student = (await db.execute({
      sql: `
        SELECT id, exam_number, password_hash, full_name, school_name, governorate, stage, group_name
        FROM students
        WHERE exam_number = ?
      `,
      args: [examNumber]
    })).rows[0];

    if (!student) {
      return res.status(401).json({ error: "الرقم الامتحاني أو الرقم السري غير صحيح." });
    }

    const valid = await bcrypt.compare(password, student.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "الرقم الامتحاني أو الرقم السري غير صحيح." });
    }

    const stats = await getStudentStats(student.id);

    res.json({
      student: {
        id: student.id,
        full_name: student.full_name,
        exam_number: student.exam_number,
        school_name: student.school_name || student.stage || "-",
        governorate: student.governorate || student.group_name || "-",
        stage: student.stage || student.school_name || "-",
        group_name: student.group_name || student.governorate || "-"
      },
      results: stats.results,
      summary: {
        total: stats.total,
        max_total: stats.max_total,
        average: stats.average,
        status: stats.status,
        count: stats.count
      }
    });

  } catch (error) {
    console.error("Student login error:", error);
    res.status(500).json({ error: "حدث خطأ أثناء معالجة الطلب." });
  }
});

/* =========================
   ADMIN AUTH ROUTES
========================= */

app.post("/api/admin/login", adminLoginLimiter, async (req, res) => {
  try {
    const password = String(req.body.password ?? "").trim();
    const adminPass = String(process.env.ADMIN_PASSWORD || "").trim();

    if (!password) {
      return res.status(400).json({ error: "يرجى إدخال كلمة مرور الإدارة." });
    }

    let isValid = false;
    if (adminPass.startsWith("$2a$") || adminPass.startsWith("$2b$")) {
      isValid = await bcrypt.compare(password, adminPass);
    } else {
      isValid = (password === adminPass);
    }

    if (!isValid) {
      return res.status(401).json({ error: "كلمة مرور الإدارة غير صحيحة." });
    }

    req.session.isAdmin = true;
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: "تعذر حفظ الجلسة." });
      }
      res.json({ success: true });
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "خطأ في الخادم أثناء تسجيل الدخول." });
  }
});

app.get("/api/admin/me", (req, res) => {
  res.json({ isAdmin: Boolean(req.session && req.session.isAdmin) });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "تعذر تسجيل الخروج." });
    }
    res.clearCookie("results_admin_session");
    res.json({ success: true });
  });
});

/* =========================
   ADMIN DASHBOARD STATS
========================= */

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const studentsTotal = (await db.execute({ sql: "SELECT COUNT(*) AS count FROM students", args: [] })).rows[0].count;
    const resultsTotal = (await db.execute({ sql: "SELECT COUNT(*) AS count FROM results", args: [] })).rows[0].count;

    const students = (await db.execute({ sql: "SELECT id FROM students", args: [] })).rows;
    let passed = 0;
    let failed = 0;
    let pending = 0;

    for (const student of students) {
      const stats = await getStudentStats(student.id);
      if (stats.count === 0) {
        pending++;
      } else if (stats.average >= 50) {
        passed++;
      } else {
        failed++;
      }
    }

    res.json({
      students: Number(studentsTotal),
      results: Number(resultsTotal),
      passed,
      failed,
      pending
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "تعذر جلب الإحصائيات." });
  }
});

/* =========================
   STUDENTS MANAGEMENT
========================= */

app.get("/api/admin/students", requireAdmin, async (req, res) => {
  try {
    const search = cleanText(req.query.search, 100);

    let rows;
    if (search) {
      rows = (await db.execute({
        sql: `
          SELECT id, exam_number, full_name, school_name, governorate, stage, group_name, plain_password, created_at
          FROM students
          WHERE full_name LIKE ? OR exam_number LIKE ? OR school_name LIKE ? OR governorate LIKE ? OR stage LIKE ? OR group_name LIKE ?
          ORDER BY id DESC
        `,
        args: [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]
      })).rows;
    } else {
      rows = (await db.execute({
        sql: `
          SELECT id, exam_number, full_name, school_name, governorate, stage, group_name, plain_password, created_at
          FROM students
          ORDER BY id DESC
        `,
        args: []
      })).rows;
    }

    const result = [];
    for (const student of rows) {
      const stats = await getStudentStats(student.id);
      result.push({
        ...student,
        school_name: student.school_name || student.stage || "",
        governorate: student.governorate || student.group_name || "",
        results_count: stats.count,
        average: stats.average,
        total: stats.total,
        max_total: stats.max_total,
        status: stats.status
      });
    }

    res.json(result);
  } catch (error) {
    console.error("Fetch students error:", error);
    res.status(500).json({ error: "تعذر جلب قائمة الطلاب." });
  }
});

app.post("/api/admin/students", requireAdmin, async (req, res) => {
  try {
    const fullName = cleanText(req.body.full_name, 200);
    const examNumber = cleanText(req.body.exam_number, 100);
    const password = String(req.body.password ?? "").trim();
    const schoolName = cleanText(req.body.school_name || req.body.stage || "", 150);
    const governorate = cleanText(req.body.governorate || req.body.group_name || "", 150);
    const stage = cleanText(req.body.stage || schoolName, 100);
    const groupName = cleanText(req.body.group_name || governorate, 100);

    if (!fullName || !examNumber || !password) {
      return res.status(400).json({
        error: "اسم الطالب والرقم الامتحاني والرقم السري مطلوبة."
      });
    }

    if (password.length < 3) {
      return res.status(400).json({
        error: "الرقم السري يجب أن يكون 3 خانات أو أكثر."
      });
    }

    const exists = (await db.execute({ sql: "SELECT id FROM students WHERE exam_number = ?", args: [examNumber] })).rows[0];
    if (exists) {
      return res.status(409).json({
        error: `الرقم الامتحاني (${examNumber}) مسجل لطالب آخر مسبقاً.`
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.execute({
      sql: `
        INSERT INTO students (exam_number, password_hash, plain_password, full_name, school_name, governorate, stage, group_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [examNumber, passwordHash, password, fullName, schoolName, governorate, stage, groupName]
    });

    const studentId = Number(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      student: {
        id: studentId,
        full_name: fullName,
        exam_number: examNumber,
        plain_password: password,
        school_name: schoolName,
        governorate: governorate,
        stage: stage,
        group_name: groupName
      }
    });

  } catch (error) {
    console.error("Add student error:", error);
    res.status(500).json({ error: "تعذر إضافة الطالب." });
  }
});

app.put("/api/admin/students/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const fullName = cleanText(req.body.full_name, 200);
    const examNumber = cleanText(req.body.exam_number, 100);
    const schoolName = cleanText(req.body.school_name || req.body.stage || "", 150);
    const governorate = cleanText(req.body.governorate || req.body.group_name || "", 150);
    const stage = cleanText(req.body.stage || schoolName, 100);
    const groupName = cleanText(req.body.group_name || governorate, 100);
    const password = String(req.body.password ?? "").trim();

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "معرف الطالب غير صحيح." });
    }

    if (!fullName || !examNumber) {
      return res.status(400).json({ error: "اسم الطالب والرقم الامتحاني مطلوبان." });
    }

    const existing = (await db.execute({ sql: "SELECT id FROM students WHERE id = ?", args: [id] })).rows[0];
    if (!existing) {
      return res.status(404).json({ error: "الطالب غير موجود." });
    }

    const duplicate = (await db.execute({ sql: "SELECT id FROM students WHERE exam_number = ? AND id != ?", args: [examNumber, id] })).rows[0];
    if (duplicate) {
      return res.status(409).json({ error: "الرقم الامتحاني مستخدم لطالب آخر." });
    }

    if (password) {
      if (password.length < 3) {
        return res.status(400).json({ error: "الرقم السري يجب أن يكون 3 خانات أو أكثر." });
      }
      const hash = await bcrypt.hash(password, 10);
      await db.execute({
        sql: `
          UPDATE students
          SET full_name = ?, exam_number = ?, school_name = ?, governorate = ?, stage = ?, group_name = ?, password_hash = ?, plain_password = ?
          WHERE id = ?
        `,
        args: [fullName, examNumber, schoolName, governorate, stage, groupName, hash, password, id]
      });
    } else {
      await db.execute({
        sql: `
          UPDATE students
          SET full_name = ?, exam_number = ?, school_name = ?, governorate = ?, stage = ?, group_name = ?
          WHERE id = ?
        `,
        args: [fullName, examNumber, schoolName, governorate, stage, groupName, id]
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Update student error:", error);
    res.status(500).json({ error: "تعذر تعديل بيانات الطالب." });
  }
});

app.delete("/api/admin/students/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "معرف الطالب غير صحيح." });
    }

    const result = await db.execute({ sql: "DELETE FROM students WHERE id = ?", args: [id] });
    if (!result.rowsAffected) {
      return res.status(404).json({ error: "الطالب غير موجود." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete student error:", error);
    res.status(500).json({ error: "تعذر حذف الطالب." });
  }
});

/* =========================
   RESULTS MANAGEMENT
========================= */

app.get("/api/admin/results/:studentId", requireAdmin, async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);
    const student = (await db.execute({
      sql: `
        SELECT id, full_name, exam_number, school_name, governorate, stage, group_name, plain_password
        FROM students
        WHERE id = ?
      `,
      args: [studentId]
    })).rows[0];

    if (!student) {
      return res.status(404).json({ error: "الطالب غير موجود." });
    }

    const stats = await getStudentStats(studentId);

    res.json({
      student: {
        ...student,
        school_name: student.school_name || student.stage || "-",
        governorate: student.governorate || student.group_name || "-"
      },
      results: stats.results,
      summary: {
        total: stats.total,
        max_total: stats.max_total,
        average: stats.average,
        status: stats.status,
        count: stats.count
      }
    });
  } catch (error) {
    console.error("Get results error:", error);
    res.status(500).json({ error: "تعذر جلب نتائج الطالب." });
  }
});

/* Add a single subject grade */
app.post("/api/admin/results", requireAdmin, async (req, res) => {
  try {
    const studentId = Number(req.body.student_id);
    const subject = cleanText(req.body.subject, 150);
    const grade = Number(req.body.grade);
    const maxGrade = Number(req.body.max_grade || 100);

    if (
      !Number.isInteger(studentId) ||
      !subject ||
      !Number.isFinite(grade) ||
      !Number.isFinite(maxGrade) ||
      maxGrade <= 0 ||
      grade < 0 ||
      grade > maxGrade
    ) {
      return res.status(400).json({
        error: "بيانات النتيجة غير صحيحة. تأكد أن الدرجة أقل أو تساوي النهاية العظمى."
      });
    }

    const student = (await db.execute({ sql: "SELECT id FROM students WHERE id = ?", args: [studentId] })).rows[0];
    if (!student) {
      return res.status(404).json({ error: "الطالب غير موجود." });
    }

    const result = await db.execute({
      sql: `
        INSERT INTO results (student_id, subject, grade, max_grade)
        VALUES (?, ?, ?, ?)
      `,
      args: [studentId, subject, grade, maxGrade]
    });

    res.status(201).json({
      success: true,
      result_id: Number(result.lastInsertRowid)
    });
  } catch (error) {
    console.error("Add result error:", error);
    res.status(500).json({ error: "تعذر إضافة النتيجة." });
  }
});

/* Add / Update batch of results for a student */
app.post("/api/admin/results/batch", requireAdmin, async (req, res) => {
  try {
    const studentId = Number(req.body.student_id);
    const items = req.body.items;
    const replaceAll = Boolean(req.body.replace_all);

    if (!Number.isInteger(studentId) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "الرجاء توفير قائمة درجات صالحة." });
    }

    const student = (await db.execute({ sql: "SELECT id FROM students WHERE id = ?", args: [studentId] })).rows[0];
    if (!student) {
      return res.status(404).json({ error: "الطالب غير موجود." });
    }

    const tx = await db.transaction("write");
    try {
      if (replaceAll) {
        await tx.execute({ sql: "DELETE FROM results WHERE student_id = ?", args: [studentId] });
      }
      for (const item of items) {
        const subject = cleanText(item.subject, 150);
        const grade = Number(item.grade);
        const maxGrade = Number(item.max_grade || 100);
        if (subject && Number.isFinite(grade) && Number.isFinite(maxGrade) && maxGrade > 0 && grade >= 0) {
          await tx.execute({
            sql: "INSERT INTO results (student_id, subject, grade, max_grade) VALUES (?, ?, ?, ?)",
            args: [studentId, subject, grade, maxGrade]
          });
        }
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    res.json({ success: true, count: items.length });
  } catch (error) {
    console.error("Batch results error:", error);
    res.status(500).json({ error: "تعذر حفظ مجموعة النتائج." });
  }
});

/* Delete a single result */
app.delete("/api/admin/results/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.execute({ sql: "DELETE FROM results WHERE id = ?", args: [id] });

    if (!result.rowsAffected) {
      return res.status(404).json({ error: "النتيجة غير موجودة." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete result error:", error);
    res.status(500).json({ error: "تعذر حذف النتيجة." });
  }
});

/* Delete all results for a student */
app.delete("/api/admin/results/student/:studentId", requireAdmin, async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);
    await db.execute({ sql: "DELETE FROM results WHERE student_id = ?", args: [studentId] });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete student results error:", error);
    res.status(500).json({ error: "تعذر حذف نتائج الطالب." });
  }
});

/* =========================
   SETTINGS MANAGEMENT
========================= */

app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  res.json(await getSettings());
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  try {
    const instituteName = cleanText(req.body.institute_name, 200);
    const platformName = cleanText(req.body.platform_name || "منصة النتائج الامتحانية", 200);
    const logoData = String(req.body.logo_data || "");

    if (!instituteName) {
      return res.status(400).json({ error: "اسم المعهد مطلوب." });
    }

    const currentSettings = await getSettings();
    let logoUrl = currentSettings.logo_url || "";
    let captchaLogoUrl = currentSettings.captcha_logo_url || "";

    /* Remove logo if requested */
    if (req.body.remove_logo === true) {
      if (logoUrl && logoUrl.startsWith("/uploads/")) {
        const oldFilePath = path.join(publicDir, logoUrl);
        if (fs.existsSync(oldFilePath)) {
          try { fs.unlinkSync(oldFilePath); } catch (e) { console.error(e); }
        }
      }
      logoUrl = "";
    }

    /* Remove captcha logo if requested */
    if (req.body.remove_captcha_logo === true) {
      if (captchaLogoUrl && captchaLogoUrl.startsWith("/uploads/")) {
        const oldFilePath = path.join(publicDir, captchaLogoUrl);
        if (fs.existsSync(oldFilePath)) {
          try { fs.unlinkSync(oldFilePath); } catch (e) { console.error(e); }
        }
      }
      captchaLogoUrl = "";
    }

    /* Upload new base64 main logo */
    if (logoData && logoData.startsWith("data:image/")) {
      const match = logoData.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/i);
      if (!match) {
        return res.status(400).json({ error: "صيغة صورة الشعار غير مدعومة." });
      }

      let ext = match[1].toLowerCase();
      if (ext === "jpeg" || ext === "jpg") ext = "jpg";
      if (ext === "svg+xml") ext = "svg";

      const filename = `institute-logo-${Date.now()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, Buffer.from(match[2], "base64"));
      logoUrl = `/uploads/${filename}`;
    }

    /* Upload new base64 captcha logo */
    const captchaLogoData = String(req.body.captcha_logo_data || "");
    if (captchaLogoData && captchaLogoData.startsWith("data:image/")) {
      const match = captchaLogoData.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/i);
      if (!match) {
        return res.status(400).json({ error: "صيغة صورة شعار التحقق غير مدعومة." });
      }

      let ext = match[1].toLowerCase();
      if (ext === "jpeg" || ext === "jpg") ext = "jpg";
      if (ext === "svg+xml") ext = "svg";

      const filename = `captcha-logo-${Date.now()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, Buffer.from(match[2], "base64"));
      captchaLogoUrl = `/uploads/${filename}`;
    }

    const captchaEnabled = req.body.captcha_enabled !== undefined ? (req.body.captcha_enabled ? 1 : 0) : (currentSettings.captcha_enabled ?? 1);
    const captchaTitle = cleanText(req.body.captcha_title !== undefined ? req.body.captcha_title : (currentSettings.captcha_title || "بوابة اور"), 100);
    const captchaText = cleanText(req.body.captcha_text !== undefined ? req.body.captcha_text : (currentSettings.captcha_text || "انا احب العراق"), 200);

    const headerRightTitle = cleanText(req.body.header_right_title !== undefined ? req.body.header_right_title : (currentSettings.header_right_title || "جمهورية العراق\nوزارة التربية"), 300);
    const headerLeftTitle = cleanText(req.body.header_left_title !== undefined ? req.body.header_left_title : (currentSettings.header_left_title || "اللجنة الدائمة للامتحانات العامة"), 300);
    const examTitle = cleanText(req.body.exam_title !== undefined ? req.body.exam_title : (currentSettings.exam_title || "نتائج الامتحانات العامة الدور الأول لعام 2025 - 2026"), 300);
    const resultFooterNote = cleanText(req.body.result_footer_note !== undefined ? req.body.result_footer_note : (currentSettings.result_footer_note || "يُعد هذا تبليغاً بنتيجة الطالب فقط، ولا يُعتبر وثيقة رسمية معتمدة لأي غرض كان."), 500);

    await db.execute({
      sql: `
        UPDATE settings
        SET
          institute_name = ?,
          platform_name = ?,
          logo_url = ?,
          captcha_enabled = ?,
          captcha_title = ?,
          captcha_text = ?,
          captcha_logo_url = ?,
          header_right_title = ?,
          header_left_title = ?,
          exam_title = ?,
          result_footer_note = ?
        WHERE id = 1
      `,
      args: [
        instituteName,
        platformName,
        logoUrl,
        captchaEnabled,
        captchaTitle,
        captchaText,
        captchaLogoUrl,
        headerRightTitle,
        headerLeftTitle,
        examTitle,
        resultFooterNote
      ]
    });

    res.json({
      success: true,
      settings: await getSettings()
    });
  } catch (error) {
    console.error("Update settings error:", error);
    res.status(500).json({ error: "تعذر حفظ الإعدادات." });
  }
});

/* Database Backup Endpoint */
app.get("/api/admin/backup", requireAdmin, (req, res) => {
  try {
    const dbPath = path.join(__dirname, "results.db");
    const filename = `backup-results-${new Date().toISOString().slice(0,10)}.db`;
    res.download(dbPath, filename);
  } catch (error) {
    console.error("Backup error:", error);
    res.status(500).json({ error: "تعذر تنزيل النسخة الاحتياطية." });
  }
});

/* =========================
   STATIC ASSETS & PAGES
========================= */

/* Static admin directory at /admin */
app.use("/admin", express.static(adminDir));

/* Static public directory at root / */
app.use(express.static(publicDir));

/* Admin page route */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});

/* Catch-all for student SPA non-API requests */
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/admin")) {
    return res.sendFile(path.join(publicDir, "index.html"));
  }
  next();
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==========================================");
  console.log("  🎓 منصة نتائج الطلاب تعمل بنجاح");
  console.log(`  🌐 واجهة الطلاب:  http://localhost:${PORT}`);
  console.log(`  🔐 لوحة الإدارة: http://localhost:${PORT}/admin`);
  console.log("==========================================");
  console.log("");
});