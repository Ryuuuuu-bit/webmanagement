// Demo data for showing every feature on a fresh install, run from the
// `start` script and gated by the SEED_DEMO_DATA variable:
//
//   SEED_DEMO_DATA=<any token>      remove previous demo data, then create a
//                                   full demo set (once per token value)
//   SEED_DEMO_DATA=remove[-<x>]     remove demo data only (once per value)
//   unset                           do nothing
//
// Everything created here is recognisable and removed by the same script:
//   - teachers  : MEMBER accounts with an @demo.local email (password below)
//   - sites     : CampusLocation names starting with "[ตัวอย่าง]"
//   - master    : Department / Room.building starting with "[ตัวอย่าง]",
//                 Course.code starting with "DEMO-", Semester "[ตัวอย่าง] …"
//   - calendar  : SchoolEvent whose detail ends with DEMO_TAG
// Real accounts, sites and settings are never modified. Records that real
// data has started to reference (e.g. a real schedule in a demo room) are
// left in place instead of failing the removal.
//
// The applied token is recorded as an AuditLog row (action DEMO_DATA) so a
// restart never repeats it; change the variable's value to run it again.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = globalThis.__demoPrisma ?? new PrismaClient();
const token = process.env.SEED_DEMO_DATA?.trim();

const DEMO_PASSWORD = "Teach2569";
const DEMO_DOMAIN = "@demo.local";
const P = "[ตัวอย่าง]";
const DEMO_TAG = "(ข้อมูลตัวอย่าง)";
const PDPA_VERSION = "2026-09-20"; // keep in sync with src/lib/consent.ts

// ---------------------------------------------------------------- dates (Asia/Bangkok)
const bkKey = (d = new Date()) => new Date(+d + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (key) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Mon
const at = (key, hm) => new Date(`${key}T${hm}:00+07:00`);
const picked = (key) => new Date(`${key}T00:00:00.000Z`); // leave / semester / event / attest / document dates
const attDay = (key) => new Date(`${key}T00:00:00+07:00`); // Attendance.date
const hm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** n-th work day (Mon–Fri) before (n<0) or after (n>0) `key`. */
function workdayFrom(key, n) {
  let k = key;
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    k = addDays(k, step);
    if (weekday(k) < 5) left--;
  }
  return k;
}

// deterministic "random" so the same token gives the same data
let seed = 20260920;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

/** A small valid one-page PDF with a title line (used for lesson plans / attachments). */
function demoPdf(title) {
  const text = title.replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "") || "Demo document";
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj 0 -28 Td /F1 11 Tf (TeachSchedule demo file - sample content) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------- removal
async function removeDemoData() {
  const users = await prisma.user.findMany({ where: { role: "MEMBER", email: { endsWith: DEMO_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.schedule.deleteMany({ where: { teacherId: { in: ids } } }),
      prisma.attendance.deleteMany({ where: { userId: { in: ids } } }),
      prisma.leaveRequest.updateMany({ where: { approverId: { in: ids } }, data: { approverId: null } }),
      prisma.leaveRequest.deleteMany({ where: { requesterId: { in: ids } } }),
      prisma.timeAttestation.updateMany({ where: { approverId: { in: ids } }, data: { approverId: null } }),
      prisma.timeAttestation.deleteMany({ where: { requesterId: { in: ids } } }),
      prisma.lessonPlan.updateMany({ where: { reviewerId: { in: ids } }, data: { reviewerId: null } }),
      prisma.lessonPlan.deleteMany({ where: { teacherId: { in: ids } } }),
      prisma.selfie.deleteMany({ where: { userId: { in: ids } } }),
      prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetUserId: { in: ids } }] } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }), // cascades notifications, documents, devices, extra sites, issues
    ]);
  }
  const kept = [];
  const tryDelete = async (label, fn) => {
    try {
      await fn();
    } catch {
      kept.push(label);
    }
  };
  await prisma.schoolEvent.deleteMany({ where: { detail: { endsWith: DEMO_TAG } } });
  for (const s of await prisma.semester.findMany({ where: { name: { startsWith: P } }, select: { id: true, name: true } })) {
    await tryDelete(s.name, () => prisma.semester.delete({ where: { id: s.id } }));
  }
  for (const c of await prisma.course.findMany({ where: { code: { startsWith: "DEMO-" } }, select: { id: true, code: true } })) {
    await tryDelete(c.code, () => prisma.course.delete({ where: { id: c.id } }));
  }
  for (const r of await prisma.room.findMany({ where: { building: { startsWith: P } }, select: { id: true, name: true } })) {
    await tryDelete(r.name, () => prisma.room.delete({ where: { id: r.id } }));
  }
  for (const d of await prisma.department.findMany({ where: { name: { startsWith: P } }, select: { id: true, name: true } })) {
    await tryDelete(d.name, () => prisma.department.delete({ where: { id: d.id } }));
  }
  const demoSites = await prisma.campusLocation.findMany({ where: { name: { startsWith: P } }, select: { id: true, name: true } });
  for (const l of demoSites) {
    await tryDelete(l.name, () => prisma.campusLocation.delete({ where: { id: l.id } }));
  }
  // Real events that were pointed at a demo school lose that school (an
  // event left with no school would turn into a school-wide one, so those
  // keep pointing at nothing instead of silently widening).
  const gone = new Set((await Promise.all(demoSites.map((l) => prisma.campusLocation.findUnique({ where: { id: l.id }, select: { id: true } })))).map((x, i) => (x ? null : demoSites[i].id)).filter(Boolean));
  if (gone.size) {
    for (const e of await prisma.schoolEvent.findMany({ where: { siteIds: { hasSome: [...gone] } }, select: { id: true, siteIds: true } })) {
      const left = e.siteIds.filter((id) => !gone.has(id));
      if (left.length) await prisma.schoolEvent.update({ where: { id: e.id }, data: { siteIds: left } });
    }
  }
  console.log(`[demo-data] removed ${ids.length} demo teacher(s)${kept.length ? ` · kept (still referenced by real data): ${kept.join(", ")}` : ""}`);
}

// ---------------------------------------------------------------- creation
async function createDemoData() {
  const now = new Date();
  const today = bkKey(now);
  const nowMin = mins(new Date(+now + 7 * 3_600_000).toISOString().slice(11, 16));
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const adminName = admin?.name ?? "ผู้ดูแลระบบ";

  // --- sites, departments, rooms
  const siteA = await prisma.campusLocation.create({
    data: { name: `${P} โรงเรียนสาธิต วิทยาเขตหลัก`, latitude: 13.7466, longitude: 100.5393, radiusMeters: 200, workStart: "08:30", workEnd: "16:30", lateGraceMinutes: 10 },
  });
  const siteB = await prisma.campusLocation.create({
    data: { name: `${P} โรงเรียนสาธิต วิทยาเขตบางนา`, latitude: 13.6676, longitude: 100.6343, radiusMeters: 150, workStart: "08:00", workEnd: "16:00", lateGraceMinutes: 10 },
  });
  const sites = { A: siteA, B: siteB };
  const deptNames = { MA: "กลุ่มสาระคณิตศาสตร์", TH: "กลุ่มสาระภาษาไทย", SC: "กลุ่มสาระวิทยาศาสตร์", EN: "กลุ่มสาระภาษาต่างประเทศ" };
  const depts = {};
  for (const [k, n] of Object.entries(deptNames)) depts[k] = await prisma.department.create({ data: { name: `${P} ${n}` } });
  const roomDefs = [
    ["ห้อง 101", "อาคาร 1", "A"],
    ["ห้อง 102", "อาคาร 1", "A"],
    ["ห้อง 201", "อาคาร 2", "A"],
    ["ห้องปฏิบัติการวิทยาศาสตร์", "อาคาร 2", "A"],
    ["ห้อง B-11", "อาคารเรียนบางนา", "B"],
    ["ห้อง B-12", "อาคารเรียนบางนา", "B"],
    ["ห้องปฏิบัติการ B-21", "อาคารเรียนบางนา", "B"],
  ];
  const rooms = [];
  for (const [name, building, s] of roomDefs) rooms.push({ ...(await prisma.room.create({ data: { name, building: `${P} ${building}`, campusLocationId: sites[s].id } })), site: s });

  // --- semester (reuse a real running one; otherwise a demo one)
  const sems = await prisma.semester.findMany();
  let semester = sems.find((s) => s.startDate.toISOString().slice(0, 10) <= today && today <= s.endDate.toISOString().slice(0, 10));
  if (!semester) {
    semester = await prisma.semester.create({
      data: { name: `${P} ภาคเรียนปัจจุบัน`, startDate: picked(addDays(today, -60)), endDate: picked(addDays(today, 60)), lessonPlanDueDate: picked(addDays(today, 7)) },
    });
  }
  const semStart = semester.startDate.toISOString().slice(0, 10);

  // --- courses
  const courseDefs = [
    ["MA-P1", "คณิตศาสตร์ ป.1", "MA", "P1_3"],
    ["MA-P4", "คณิตศาสตร์ ป.4", "MA", "P4_6"],
    ["MA-M1", "คณิตศาสตร์ ม.1", "MA", "M1_3"],
    ["MA-M4", "คณิตศาสตร์เพิ่มเติม ม.4", "MA", "M4_6"],
    ["TH-KG", "ภาษาไทยปฐมวัย", "TH", "KG"],
    ["TH-P2", "ภาษาไทย ป.2", "TH", "P1_3"],
    ["TH-P5", "ภาษาไทย ป.5", "TH", "P4_6"],
    ["TH-M2", "ภาษาไทย ม.2", "TH", "M1_3"],
    ["SC-P5", "วิทยาศาสตร์ ป.5", "SC", "P4_6"],
    ["SC-M3", "วิทยาศาสตร์ ม.3", "SC", "M1_3"],
    ["SC-M5", "ฟิสิกส์ ม.5", "SC", "M4_6"],
    ["EN-KG", "Phonics อนุบาล", "EN", "KG"],
    ["EN-P1", "English for Kids ป.1", "EN", "P1_3"],
    ["EN-M1", "English Conversation ม.1", "EN", "M1_3"],
    ["EN-M4", "English Reading ม.4", "EN", "M4_6"],
  ];
  const courses = [];
  for (const [code, name, dept, grade] of courseDefs) {
    courses.push({ ...(await prisma.course.create({ data: { code: `DEMO-${code}`, name, gradeLevel: grade } })), dept, grade });
  }

  // --- teachers
  const T = [
    ["อ.สมชาย ใจดี", "demo.somchai", "MA", "A", ["P4_6", "M1_3"]],
    ["อ.สมหญิง รักเรียน", "demo.somying", "TH", "A", ["P1_3", "P4_6"]],
    ["อ.วิชัย มั่นคง", "demo.wichai", "SC", "A", ["M1_3", "M4_6"]],
    ["อ.กนกพร ศรีสุข", "demo.kanokporn", "EN", "A", ["P1_3"]],
    ["อ.ธนพล วงศ์ใหญ่", "demo.thanapol", "MA", "A", ["M4_6"]],
    ["อ.ปิยะนุช แก้วมณี", "demo.piyanuch", "SC", "B", ["P4_6"]],
    ["Mr. James Carter", "demo.james", "EN", "A", ["M1_3", "M4_6"]],
    ["Ms. Emily Watson", "demo.emily", "EN", "B", ["KG", "P1_3"]],
    ["อ.ณัฐวุฒิ ทองดี", "demo.nattawut", "TH", "B", ["M1_3"]],
    ["อ.พรทิพย์ บุญมา", "demo.pornthip", "MA", "B", ["P1_3"]],
    ["อ.อนุชา สายทอง", "demo.anucha", "SC", "B", ["M4_6", "M1_3"]],
    ["อ.มาลัย จันทร์เพ็ญ", "demo.malai", "TH", "B", ["KG"]],
  ];
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const teachers = [];
  for (const [i, [name, username, dept, site, grades]] of T.entries()) {
    const u = await prisma.user.create({
      data: {
        name,
        username,
        email: `${username.replace("demo.", "")}${DEMO_DOMAIN}`,
        passwordHash,
        role: "MEMBER",
        departmentId: depts[dept].id,
        campusLocationId: sites[site].id,
        gradeLevels: grades,
        passwordSetAt: new Date(+now - 40 * 86_400_000),
        lastLoginAt: new Date(+now - between(1, 30) * 3_600_000),
        consentAt: new Date(+now - 40 * 86_400_000),
        consentVersion: PDPA_VERSION,
        createdAt: new Date(`${addDays(today, -75)}T09:00:00+07:00`),
      },
    });
    teachers.push({ ...u, i, dept, site, grades });
  }
  const t = (i) => teachers[i];
  // extra sites: teaches at both campuses
  await prisma.userSite.createMany({ data: [{ userId: t(0).id, locationId: siteB.id }, { userId: t(7).id, locationId: siteA.id }] });

  // --- timetable (no teacher / room double-booking)
  const PERIODS = [["08:30", "09:20"], ["09:20", "10:10"], ["10:20", "11:10"], ["11:10", "12:00"], ["13:00", "13:50"], ["13:50", "14:40"], ["14:50", "15:40"]];
  const busy = new Set();
  const teacherCourses = new Map();
  const schedules = []; // { id, who, d, p }
  const notes = ["สอบย่อยบทที่ 3", "ส่งงานกลุ่ม", "ใช้ห้องคอมพิวเตอร์", null, null, null];
  for (const tc of teachers) {
    const mine = courses.filter((c) => c.dept === tc.dept && tc.grades.includes(c.grade));
    const list = mine.length ? mine : courses.filter((c) => c.dept === tc.dept).slice(0, 1);
    teacherCourses.set(tc.id, list);
    const siteRooms = rooms.filter((r) => r.site === tc.site);
    const want = between(7, 11);
    const slots = [];
    for (let d = 0; d < 5; d++) for (let p = 0; p < PERIODS.length; p++) slots.push([d, p]);
    slots.sort(() => rnd() - 0.5);
    let made = 0;
    for (const [d, p] of slots) {
      if (made >= want) break;
      if (busy.has(`t|${tc.id}|${d}|${p}`)) continue;
      const room = siteRooms.find((r) => !busy.has(`r|${r.id}|${d}|${p}`));
      if (!room) continue;
      busy.add(`t|${tc.id}|${d}|${p}`);
      busy.add(`r|${room.id}|${d}|${p}`);
      const course = list[made % list.length];
      const row = await prisma.schedule.create({
        data: { teacherId: tc.id, courseId: course.id, roomId: room.id, semesterId: semester.id, dayOfWeek: d, startTime: PERIODS[p][0], endTime: PERIODS[p][1], note: notes[between(0, notes.length - 1)] },
      });
      schedules.push({ id: row.id, who: tc.i, d, p });
      made++;
    }
  }

  // --- school calendar (holidays affect leave counting, absences, reminders, reports)
  const sitePastHoliday = workdayFrom(today, -8);
  const events = [
    { title: "หยุดชดเชยกีฬาสี", startDate: picked(sitePastHoliday), endDate: picked(sitePastHoliday), isHoliday: true, siteIds: [siteA.id] },
    { title: "วันคล้ายวันสวรรคต ร.9", startDate: picked("2026-10-13"), endDate: picked("2026-10-13"), isHoliday: true },
    { title: "วันปิยมหาราช", startDate: picked("2026-10-23"), endDate: picked("2026-10-23"), isHoliday: true },
    { title: "วันพ่อแห่งชาติ (ชดเชย)", startDate: picked("2026-12-07"), endDate: picked("2026-12-07"), isHoliday: true },
    { title: "วันรัฐธรรมนูญ", startDate: picked("2026-12-10"), endDate: picked("2026-12-10"), isHoliday: true },
    { title: "วันสิ้นปี", startDate: picked("2026-12-31"), endDate: picked("2026-12-31"), isHoliday: true },
    { title: "ประชุมผู้ปกครองภาคเรียน", startDate: picked(workdayFrom(today, 4)), endDate: picked(workdayFrom(today, 4)), siteIds: [siteA.id] },
    { title: "สอบกลางภาค", startDate: picked(workdayFrom(today, 10)), endDate: picked(workdayFrom(today, 14)), siteIds: [siteA.id, siteB.id] },
    { title: "กีฬาสีวิทยาเขตบางนา", startDate: picked(workdayFrom(today, 17)), endDate: picked(workdayFrom(today, 17)), siteIds: [siteB.id] },
    { title: "อบรมครู: การวัดผลประเมินผล", startDate: picked(workdayFrom(today, 6)), endDate: picked(workdayFrom(today, 6)) },
  ];
  for (const e of events) await prisma.schoolEvent.create({ data: { ...e, detail: `ใช้สาธิตปฏิทินโรงเรียน ${DEMO_TAG}`, createdById: admin?.id ?? null } });
  const holidayFor = (key, site) => events.some((e) => e.isHoliday && e.startDate.toISOString().slice(0, 10) <= key && key <= e.endDate.toISOString().slice(0, 10) && (!e.siteIds?.length || e.siteIds.includes(sites[site].id)));
  const isWork = (key, site) => weekday(key) < 5 && !holidayFor(key, site);

  // --- leave requests
  const decided = (key, h = "10:15") => at(key, h);
  const pdf = (title) => {
    const data = demoPdf(title);
    return { attachmentName: `${title}.pdf`, attachmentMime: "application/pdf", attachmentSize: data.length, attachmentData: data };
  };
  const vacStart = (() => {
    let k = addDays(today, -21);
    while (weekday(k) !== 3) k = addDays(k, -1); // Thursday → following Monday
    return k;
  })();
  const halfAmDay = workdayFrom(today, -6);
  const leaves = [
    { who: 1, type: "SICK", from: today, to: today, reason: "มีไข้ ไปพบแพทย์", status: "APPROVED", created: addDays(today, -1), file: "medical-certificate" },
    { who: 5, type: "PERSONAL", from: today, to: today, reason: "พาบุตรไปพบแพทย์ตามนัด", status: "PENDING", created: today },
    { who: 3, type: "VACATION", from: vacStart, to: addDays(vacStart, 4), reason: "พักร้อนต่างจังหวัด (คร่อมเสาร์-อาทิตย์ นับ 3 วันทำงาน)", status: "APPROVED", created: addDays(vacStart, -10) },
    { who: 2, type: "PERSONAL", from: halfAmDay, to: halfAmDay, half: "AM", reason: "ติดต่อราชการช่วงเช้า เข้างานช่วงบ่าย", status: "APPROVED", created: addDays(halfAmDay, -3) },
    { who: 6, type: "SICK", from: workdayFrom(today, -16), to: workdayFrom(today, -15), reason: "Food poisoning", status: "APPROVED", created: workdayFrom(today, -16), file: "clinic-receipt" },
    { who: 8, type: "PERSONAL", from: workdayFrom(today, 5), to: workdayFrom(today, 5), reason: "ไปงานบวชน้องชาย", status: "PENDING", created: addDays(today, -1) },
    { who: 9, type: "TRAINING", from: workdayFrom(today, 8), to: workdayFrom(today, 9), reason: "อบรมหลักสูตร Active Learning (สพฐ.)", status: "APPROVED", created: addDays(today, -6) },
    { who: 7, type: "VACATION", from: workdayFrom(today, 3), to: workdayFrom(today, 5), reason: "Family trip", status: "REJECTED", created: addDays(today, -4) },
    { who: 10, type: "SICK", from: workdayFrom(today, -3), to: workdayFrom(today, -3), reason: "ปวดหัว (ยกเลิกเพราะมาทำงานได้)", status: "CANCELLED", created: workdayFrom(today, -4) },
    { who: 11, type: "PERSONAL", from: workdayFrom(today, 1), to: workdayFrom(today, 1), half: "PM", reason: "ไปธนาคารช่วงบ่าย", status: "PENDING", created: today },
    { who: 0, type: "SICK", from: workdayFrom(today, -1), to: workdayFrom(today, -1), half: "PM", reason: "ปวดท้อง ขอกลับช่วงบ่าย", status: "PENDING", created: addDays(today, -3), file: "doctor-note" },
  ];
  const leaveDays = new Map(); // `${who}|${key}` -> "FULL" | "AM" | "PM"
  for (const l of leaves) {
    const done = l.status === "APPROVED" || l.status === "REJECTED";
    const created = new Date(`${l.created}T${hm(between(7 * 60, 9 * 60))}:00+07:00`);
    await prisma.leaveRequest.create({
      data: {
        requesterId: t(l.who).id,
        type: l.type,
        startDate: picked(l.from),
        endDate: picked(l.to),
        halfDay: l.half ?? null,
        reason: l.reason,
        status: l.status,
        approverId: done ? admin?.id ?? null : null,
        decidedAt: done ? new Date(Math.min(+now, +created + 26 * 3_600_000)) : null,
        cancelledAt: l.status === "CANCELLED" ? new Date(+created + 3 * 3_600_000) : null,
        createdAt: created,
        ...(l.file ? pdf(l.file) : {}),
      },
    });
    if (l.status === "APPROVED") for (let k = l.from; k <= l.to; k = addDays(k, 1)) leaveDays.set(`${l.who}|${k}`, l.half ?? "FULL");
  }

  // --- substitute bookings ("ครูสอนแทน"): cover some of the classes of a
  // teacher on leave today and on a future training day; leave the rest open
  // so the "classes without a substitute" list has something to show.
  let subs = 0;
  const book = async (who, key, max, note) => {
    if (weekday(key) > 4) return;
    const mine = schedules.filter((x) => x.who === who && x.d === weekday(key)).slice(0, max);
    for (const cls of mine) {
      const free = teachers.find((o) => o.i !== who && ![1, 4, 5, 10].includes(o.i) && o.site === t(who).site && !busy.has(`t|${o.id}|${cls.d}|${cls.p}`));
      if (!free) continue;
      busy.add(`t|${free.id}|${cls.d}|${cls.p}`);
      await prisma.substituteAssignment.create({ data: { date: picked(key), scheduleId: cls.id, absentTeacherId: t(who).id, substituteId: free.id, note, createdById: admin?.id ?? null } });
      subs++;
    }
  };
  if (prisma.substituteAssignment) {
    await book(1, today, 1, "ใช้ใบงานที่ อ.สมหญิง เตรียมไว้ในห้องพักครู");
    await book(9, workdayFrom(today, 8), 2, "ทบทวนบทที่ 4 + แบบฝึกหัด");
  }

  // --- attendance history (from the semester start or ~6 weeks back, up to today)
  const from = semStart > addDays(today, -42) ? semStart : addDays(today, -42);
  const attestApprovedDay = workdayFrom(today, -9); // t3 forgot check-in → approved
  const attestCheckoutDay = workdayFrom(today, -1); // t9 forgot check-out → pending
  const attestCheckinDay = workdayFrom(today, -2); // t5 checked out only → pending
  const attestBothDay = workdayFrom(today, -4); // t7 nothing recorded → pending FORGOT_BOTH
  const attestRejectedDay = workdayFrom(today, -12); // t4 → rejected
  const absentDays = new Map([[`8|${workdayFrom(today, -3)}`, true], [`8|${workdayFrom(today, -11)}`, true], [`4|${workdayFrom(today, -7)}`, true]]);
  const noRecordDays = new Set([`10|${workdayFrom(today, -5)}`, `10|${workdayFrom(today, -13)}`]);
  const lateRate = { 6: 0.3, 2: 0.15, 9: 0.12 };
  const notCheckedInToday = new Set([4, 10]);
  const rows = [];
  for (let key = from; key <= today; key = addDays(key, 1)) {
    for (const tc of teachers) {
      if (key < bkKey(tc.createdAt) || !isWork(key, tc.site)) continue;
      const k = `${tc.i}|${key}`;
      const isToday = key === today;
      const leave = leaveDays.get(k);
      const base = { userId: tc.id, date: attDay(key) };
      if (leave === "FULL") {
        rows.push({ ...base, status: "LEAVE" });
        continue;
      }
      if (absentDays.has(k)) {
        rows.push({ ...base, status: "ABSENT" });
        continue;
      }
      if (noRecordDays.has(k) || (tc.i === 7 && key === attestBothDay)) continue;
      if (isToday && (notCheckedInToday.has(tc.i) || (tc.i === 5))) continue;
      // which site they check in at (t0 teaches at Bang Na on Tuesdays)
      const siteKey = tc.i === 0 && weekday(key) === 1 ? "B" : tc.i === 7 && weekday(key) === 3 ? "A" : tc.site;
      const site = sites[siteKey];
      const startMin = mins(site.workStart);
      const endMin = mins(site.workEnd);
      let inMin;
      let status = "ON_TIME";
      if (leave === "AM") inMin = mins("12:40") + between(0, 25); // afternoon start 13:00 + grace → on time
      else if (rnd() < (lateRate[tc.i] ?? 0.05)) {
        inMin = startMin + 11 + between(0, 40);
        status = "LATE";
      } else inMin = startMin - between(5, 40);
      let outMin = leave === "PM" ? mins("12:05") + between(0, 10) : endMin + between(0, 50);
      let early = false;
      if (tc.i === 11 && rnd() < 0.15) {
        outMin = endMin - between(20, 45);
        early = true;
      }
      const jitter = () => (rnd() - 0.5) * 0.0006;
      const row = {
        ...base,
        status,
        checkinAt: at(key, hm(inMin)),
        checkinLat: site.latitude + jitter(),
        checkinLng: site.longitude + jitter(),
        checkinMethod: rnd() < 0.85 ? "webauthn" : "session",
        checkinDeviceId: `demo-dev-${String(tc.i).padStart(2, "0")}`,
        checkinSiteId: site.id,
        checkinSiteName: site.name,
        checkoutAt: at(key, hm(outMin)),
        checkoutLat: site.latitude + jitter(),
        checkoutLng: site.longitude + jitter(),
        checkoutMethod: "webauthn",
        checkoutDeviceId: `demo-dev-${String(tc.i).padStart(2, "0")}`,
        checkoutSiteId: site.id,
        checkoutSiteName: site.name,
        earlyCheckout: early,
      };
      if (tc.i === 3 && key === attestApprovedDay) Object.assign(row, { checkinAt: at(key, "08:20"), attestedCheckin: true, checkinMethod: null, checkinLat: null, checkinLng: null, checkinDeviceId: null, checkinSiteId: null, checkinSiteName: null, status: "ON_TIME" });
      if ((tc.i === 9 && key === attestCheckoutDay) || (tc.i === 4 && key === attestRejectedDay)) Object.assign(row, { checkoutAt: null, checkoutLat: null, checkoutLng: null, checkoutMethod: null, checkoutDeviceId: null, checkoutSiteId: null, checkoutSiteName: null });
      if (tc.i === 5 && key === attestCheckinDay) Object.assign(row, { checkinAt: null, checkinLat: null, checkinLng: null, checkinMethod: null, checkinDeviceId: null, checkinSiteId: null, checkinSiteName: null, status: "PENDING" });
      if (isToday) {
        if (inMin > nowMin) continue; // not in yet at seeding time
        if (outMin > nowMin) Object.assign(row, { checkoutAt: null, checkoutLat: null, checkoutLng: null, checkoutMethod: null, checkoutDeviceId: null, checkoutSiteId: null, checkoutSiteName: null, earlyCheckout: false });
      }
      rows.push(row);
    }
  }
  for (let i = 0; i < rows.length; i += 200) await prisma.attendance.createMany({ data: rows.slice(i, i + 200) });

  // --- time attestations
  const attests = [
    { who: 3, day: attestApprovedDay, type: "FORGOT_CHECKIN", time: "08:20", reason: "ลืมเช็คอิน มาถึงก่อนเข้าแถว (มีพยาน อ.สมหญิง)", status: "APPROVED" },
    { who: 9, day: attestCheckoutDay, type: "FORGOT_CHECKOUT", time: "16:40", reason: "แบตโทรศัพท์หมดตอนเลิกงาน", status: "PENDING" },
    { who: 5, day: attestCheckinDay, type: "FORGOT_CHECKIN", time: "07:55", reason: "รีบไปคุมนักเรียนหน้าประตู ลืมกดเช็คอิน", status: "PENDING" },
    { who: 7, day: attestBothDay, type: "FORGOT_BOTH", time: "07:50", out: "16:10", reason: "Phone was being repaired that day", status: "PENDING" },
    { who: 4, day: attestRejectedDay, type: "FORGOT_CHECKOUT", time: "18:30", reason: "อยู่ตรวจข้อสอบถึงเย็น", status: "REJECTED" },
  ];
  for (const a of attests) {
    const done = a.status !== "PENDING";
    const created = at(addDays(a.day, 1), hm(between(8 * 60, 10 * 60)));
    await prisma.timeAttestation.create({
      data: {
        requesterId: t(a.who).id,
        date: picked(a.day),
        type: a.type,
        requestedTime: a.time,
        requestedCheckoutTime: a.out ?? null,
        reason: a.reason,
        status: a.status,
        approverId: done ? admin?.id ?? null : null,
        decidedAt: done ? new Date(+created + 5 * 3_600_000) : null,
        createdAt: new Date(Math.min(+now, +created)),
      },
    });
  }

  // --- lesson plans for the semester (some missing on purpose)
  const lpStatuses = ["APPROVED", "APPROVED", "PENDING", "NEEDS_REVISION", "MISSING", "APPROVED", "PENDING"];
  let lpIdx = 0;
  for (const tc of teachers) {
    for (const c of teacherCourses.get(tc.id)) {
      const st = lpStatuses[lpIdx++ % lpStatuses.length];
      if (st === "MISSING") continue;
      const data = demoPdf(`Lesson plan ${c.code}`);
      const submitted = at(addDays(today, -between(3, 25)), hm(between(9 * 60, 17 * 60)));
      await prisma.lessonPlan.create({
        data: {
          teacherId: tc.id,
          courseId: c.id,
          semesterId: semester.id,
          fileName: `แผนการสอน-${c.code.replace("DEMO-", "")}.pdf`,
          fileData: data,
          mimeType: "application/pdf",
          fileSize: data.length,
          status: st,
          reviewerId: st === "PENDING" ? null : admin?.id ?? null,
          reviewNote: st === "NEEDS_REVISION" ? "เพิ่มเกณฑ์การประเมินผลและแผนสำรองกรณีนักเรียนขาดเรียน" : null,
          submittedAt: submitted,
          decidedAt: st === "PENDING" ? null : new Date(Math.min(+now, +submitted + 2 * 86_400_000)),
        },
      });
    }
  }

  // --- personnel documents (work permit / visa / … for the foreign teachers)
  if ((await prisma.documentType.count()) === 0) {
    const defs = [
      ["Work Permit", "90,60"],
      ["Visa", "90,60"],
      ["Passport", "180,90"],
      ["90-Day Report (ตม.47)", "14,7"],
      ["ใบอนุญาตประกอบวิชาชีพครู", "90,60"],
    ];
    await prisma.documentType.createMany({ data: defs.map(([name, remindDays], sortOrder) => ({ name, remindDays, sortOrder })), skipDuplicates: true });
  }
  const types = await prisma.documentType.findMany();
  const typeOf = (frag) => types.find((x) => x.name.toLowerCase().includes(frag.toLowerCase()));
  const docs = [
    [6, "Work Permit", "WP-6612-0458", -320, 45],
    [6, "Visa", "Non-B 0927731", -270, 120],
    [6, "Passport", "565123987", -900, 1300],
    [6, "90-Day", "TM47-118842", -80, 10],
    [7, "Work Permit", "WP-6702-1190", -160, 205],
    [7, "Visa", "Non-B 1048820", -360, -5],
    [7, "Passport", "C02X44817", -1500, 2100],
    [7, "90-Day", "TM47-120377", -30, 60],
    [0, "วิชาชีพ", "64100001234", -1400, 420],
    [1, "วิชาชีพ", "63100009876", -1700, 120],
    [2, "วิชาชีพ", "65100004455", -900, 900],
    [3, "วิชาชีพ", "66100007788", -500, 1300],
    [4, "วิชาชีพ", "62100003322", -1750, 75],
    [5, "วิชาชีพ", "64100006611", -1200, 600],
    [8, "วิชาชีพ", "61100005544", -1850, -20],
    [9, "วิชาชีพ", "65100008899", -700, 1100],
    [10, "วิชาชีพ", "63100002211", -1500, 300],
  ];
  for (const [who, frag, number, issued, expires] of docs) {
    const type = typeOf(frag);
    if (!type) continue;
    await prisma.teacherDocument.create({
      data: {
        userId: t(who).id,
        typeId: type.id,
        number,
        issueDate: picked(addDays(today, issued)),
        expiryDate: picked(addDays(today, expires)),
        note: expires < 0 ? "รอต่ออายุ — ยื่นเอกสารแล้ว" : null,
        ...(who === 6 && frag === "Work Permit" ? pdf("work-permit-scan") : {}),
      },
    });
  }

  // --- devices (one waiting for approval)
  const labels = ["iPhone 15 (Safari)", "iPhone 13 (Safari)", "Samsung Galaxy S23 (Chrome)", "iPad Air (Safari)", "Xiaomi 13T (Chrome)", "OPPO Reno10 (Chrome)", "iPhone 14 Pro (Safari)", "Pixel 8 (Chrome)", "iPhone 12 (Safari)", "Vivo V29 (Chrome)"];
  for (const tc of teachers) {
    if (tc.i === 11) continue; // never registered
    const pending = tc.i === 10;
    await prisma.webauthnCredential.create({
      data: {
        userId: tc.id,
        credentialId: `demo-${crypto.randomBytes(18).toString("base64url")}`,
        publicKey: crypto.randomBytes(77),
        deviceType: "multiDevice",
        backedUp: true,
        transports: "internal,hybrid",
        label: pending ? "Samsung Galaxy A54 (Chrome)" : labels[tc.i % labels.length],
        pending,
        approvedById: pending ? null : admin?.id ?? null,
        approvedAt: pending ? null : new Date(+now - 35 * 86_400_000),
        createdAt: pending ? new Date(+now - 26 * 3_600_000) : new Date(+now - 36 * 86_400_000),
        lastUsedAt: pending ? null : new Date(+now - between(1, 20) * 3_600_000),
      },
    });
  }

  // --- feedback / issue reports
  const issues = [
    { who: 2, category: "BUG", area: "checkin", title: "กดเช็คเอาต์แล้วหมุนค้าง", detail: "เมื่อวานกดเช็คเอาต์ตอน 16:35 หน้าจอหมุนค้างประมาณ 1 นาที แต่สุดท้ายบันทึกได้", status: "OPEN", ago: 1 },
    { who: 7, category: "SUGGESTION", area: "schedule", title: "Show room map in the timetable", detail: "It would help new teachers if the room name linked to a building map.", status: "IN_PROGRESS", note: "รับเรื่องแล้ว จะเพิ่มในรอบถัดไป", ago: 6 },
    { who: 9, category: "QUESTION", area: "leave", title: "ลาครึ่งวันนับโควต้ายังไง", detail: "ถ้าลาครึ่งวันเช้า ระบบหักโควต้าลากิจกี่วันคะ", status: "RESOLVED", note: "ลาครึ่งวันนับ 0.5 วัน และไม่นับวันหยุด/เสาร์-อาทิตย์", ago: 9 },
  ];
  for (const s of issues) {
    await prisma.issueReport.create({
      data: {
        reporterId: t(s.who).id,
        category: s.category,
        area: s.area,
        title: s.title,
        detail: s.detail,
        pageUrl: `/${s.area === "checkin" ? "checkin" : s.area}`,
        device: "iPhone · Safari 18",
        status: s.status,
        adminNote: s.note ?? null,
        handlerId: s.note ? admin?.id ?? null : null,
        createdAt: new Date(+now - s.ago * 86_400_000),
      },
    });
  }

  // --- a few notifications in the teachers' inboxes
  const n = (who, kind, params, href, hoursAgo, read = false) => ({
    userId: t(who).id,
    kind,
    params,
    href,
    createdAt: new Date(+now - hoursAgo * 3_600_000),
    readAt: read ? new Date(+now - (hoursAgo - 1) * 3_600_000) : null,
  });
  const absent8 = [workdayFrom(today, -11), workdayFrom(today, -3)];
  await prisma.notification.createMany({
    data: [
      n(1, "LEAVE_DECIDED", { decision: "APPROVED", type: "SICK", from: picked(today).toISOString(), to: picked(today).toISOString(), approverName: adminName }, "/leave", 12),
      n(7, "LEAVE_DECIDED", { decision: "REJECTED", type: "VACATION", from: picked(workdayFrom(today, 3)).toISOString(), to: picked(workdayFrom(today, 5)).toISOString(), approverName: adminName }, "/leave", 30),
      n(3, "ATTEST_DECIDED", { decision: "APPROVED", type: "FORGOT_CHECKIN", date: picked(attestApprovedDay).toISOString(), approverName: adminName }, "/attest", 150, true),
      n(8, "ABSENT_MARKED", { count: 2, dates: absent8.join(",") }, "/attest", 20),
      n(6, "DOC_EXPIRING", { type: "Work Permit", daysLeft: 45, expiry: picked(addDays(today, 45)).toISOString() }, "/documents", 8),
      n(7, "DOC_EXPIRING", { type: "Visa", daysLeft: -5, expiry: picked(addDays(today, -5)).toISOString() }, "/documents", 6),
      n(2, "ISSUE_UPDATED", { title: issues[0].title, status: "OPEN", hasNote: false, note: "", handlerName: adminName }, "/feedback", 2),
      n(9, "ISSUE_UPDATED", { title: issues[2].title, status: "RESOLVED", hasNote: true, note: issues[2].note, handlerName: adminName }, "/feedback", 200, true),
      n(0, "SITES_UPDATED", { siteNames: siteB.name }, "/checkin", 700, true),
    ],
  });

  console.log(
    `[demo-data] created 2 sites, ${rooms.length} rooms, ${courses.length} courses, ${teachers.length} teachers (password ${DEMO_PASSWORD}), ` +
      `${rows.length} attendance rows, ${leaves.length} leave requests, ${attests.length} attestations, ${docs.length} documents, ${events.length} calendar events, ${subs} substitute bookings · semester "${semester.name}"`
  );
}

try {
  if (!token) {
    console.log("[demo-data] SEED_DEMO_DATA not set — skipping");
  } else if (await prisma.auditLog.findFirst({ where: { action: "DEMO_DATA", detail: `token=${token}` } })) {
    console.log("[demo-data] token already applied — skipping");
  } else {
    await removeDemoData();
    if (!/^remove/i.test(token)) await createDemoData();
    await prisma.auditLog.create({ data: { action: "DEMO_DATA", detail: `token=${token}` } });
    console.log("[demo-data] done");
  }
} catch (err) {
  console.error("[demo-data] failed:", err?.stack ?? err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
