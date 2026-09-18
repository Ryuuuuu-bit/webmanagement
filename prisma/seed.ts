import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  const [eng, biz, arts] = await Promise.all([
    prisma.department.upsert({ where: { name: "วิศวกรรมศาสตร์" }, update: {}, create: { name: "วิศวกรรมศาสตร์" } }),
    prisma.department.upsert({ where: { name: "บริหารธุรกิจ" }, update: {}, create: { name: "บริหารธุรกิจ" } }),
    prisma.department.upsert({ where: { name: "ศิลปศาสตร์" }, update: {}, create: { name: "ศิลปศาสตร์" } }),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@university.ac.th" },
    update: {},
    create: { name: "ผู้ดูแลระบบ", email: "admin@university.ac.th", passwordHash: password, role: Role.ADMIN },
  });

  const teacherData = [
    { name: "อ.สมชาย ใจดี", email: "somchai@university.ac.th", role: Role.MEMBER, dept: eng.id },
    { name: "อ.สุภาพร วงศ์ตระกูล", email: "supaporn@university.ac.th", role: Role.MEMBER, dept: biz.id },
    { name: "ผศ.ดร.กมลวรรณ ทองอยู่", email: "kamonwan@university.ac.th", role: Role.SENIOR, dept: eng.id },
    { name: "อ.ประยุทธ์ ศรีสุข", email: "prayuth@university.ac.th", role: Role.MEMBER, dept: arts.id },
    { name: "อ.นภัสสร เพชรรัตน์", email: "napassorn@university.ac.th", role: Role.MEMBER, dept: biz.id },
    { name: "อ.ธนกร อินทร์แก้ว", email: "thanakorn@university.ac.th", role: Role.MEMBER, dept: eng.id },
  ];

  const teachers = [];
  for (const t of teacherData) {
    const u = await prisma.user.upsert({
      where: { email: t.email },
      update: {},
      create: { name: t.name, email: t.email, passwordHash: password, role: t.role, departmentId: t.dept },
    });
    teachers.push(u);
  }
  const [somchai, supaporn, kamonwan, prayuth, napassorn, thanakorn] = teachers;

  const [cs201, ma101, ba210, me220, en101] = await Promise.all([
    prisma.course.upsert({ where: { code: "CS201" }, update: {}, create: { code: "CS201", name: "โครงสร้างข้อมูล" } }),
    prisma.course.upsert({ where: { code: "MA101" }, update: {}, create: { code: "MA101", name: "แคลคูลัส 1" } }),
    prisma.course.upsert({ where: { code: "BA210" }, update: {}, create: { code: "BA210", name: "พฤติกรรมองค์การ" } }),
    prisma.course.upsert({ where: { code: "ME220" }, update: {}, create: { code: "ME220", name: "อุณหพลศาสตร์" } }),
    prisma.course.upsert({ where: { code: "EN101" }, update: {}, create: { code: "EN101", name: "ภาษาอังกฤษเพื่อการสื่อสาร" } }),
  ]);

  const lab105 = await prisma.room.create({ data: { name: "Lab 105", building: "อาคารวิศวกรรมศาสตร์" } });
  const room301 = await prisma.room.create({ data: { name: "ห้อง 301", building: "อาคารวิศวกรรมศาสตร์" } });
  const roomB204 = await prisma.room.create({ data: { name: "ห้อง B204", building: "อาคารบริหารธุรกิจ" } });
  const room204 = await prisma.room.create({ data: { name: "ห้อง 204", building: "อาคารศิลปศาสตร์" } });

  const semester = await prisma.semester.create({
    data: { name: "1/2569", startDate: new Date("2026-08-01"), endDate: new Date("2026-12-15") },
  });

  const periods = [
    { i: 0, s: "08:30", e: "10:20" },
    { i: 1, s: "10:30", e: "12:20" },
    { i: 2, s: "13:00", e: "14:50" },
    { i: 3, s: "15:00", e: "16:50" },
  ];

  const scheduleRows = [
    { teacherId: somchai.id, courseId: cs201.id, roomId: lab105.id, dayOfWeek: 0, period: periods[0] },
    { teacherId: somchai.id, courseId: me220.id, roomId: room301.id, dayOfWeek: 0, period: periods[2] },
    { teacherId: somchai.id, courseId: cs201.id, roomId: lab105.id, dayOfWeek: 2, period: periods[0] },
    { teacherId: somchai.id, courseId: me220.id, roomId: room301.id, dayOfWeek: 4, period: periods[1] },
    { teacherId: supaporn.id, courseId: ba210.id, roomId: roomB204.id, dayOfWeek: 1, period: periods[0] },
    { teacherId: supaporn.id, courseId: ba210.id, roomId: roomB204.id, dayOfWeek: 3, period: periods[2] },
    { teacherId: kamonwan.id, courseId: ma101.id, roomId: room301.id, dayOfWeek: 0, period: periods[1] },
    { teacherId: kamonwan.id, courseId: ma101.id, roomId: room301.id, dayOfWeek: 2, period: periods[1] },
    { teacherId: prayuth.id, courseId: en101.id, roomId: room204.id, dayOfWeek: 1, period: periods[2] },
  ];

  for (const row of scheduleRows) {
    await prisma.schedule.create({
      data: {
        teacherId: row.teacherId,
        courseId: row.courseId,
        roomId: row.roomId,
        semesterId: semester.id,
        dayOfWeek: row.dayOfWeek,
        periodIndex: row.period.i,
        startTime: row.period.s,
        endTime: row.period.e,
      },
    });
  }

  // Example campus geofence — replace with the real coordinates for each building (FR-17).
  await prisma.campusLocation.createMany({
    data: [
      { name: "อาคารวิศวกรรมศาสตร์", latitude: 13.736717, longitude: 100.523186, radiusMeters: 150 },
      { name: "อาคารบริหารธุรกิจ", latitude: 13.737200, longitude: 100.524500, radiusMeters: 150 },
    ],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.attendance.createMany({
    data: [
      { userId: supaporn.id, date: today, checkinAt: new Date(new Date().setHours(8, 22)), status: "ON_TIME" },
      { userId: kamonwan.id, date: today, checkinAt: new Date(new Date().setHours(8, 10)), checkoutAt: new Date(new Date().setHours(17, 5)), status: "ON_TIME" },
      { userId: prayuth.id, date: today, checkinAt: new Date(new Date().setHours(8, 47)), status: "LATE" },
      { userId: thanakorn.id, date: today, status: "ABSENT" },
    ],
    skipDuplicates: true,
  });

  await prisma.leaveRequest.create({
    data: {
      requesterId: napassorn.id,
      type: "PERSONAL",
      startDate: new Date("2026-09-20"),
      endDate: new Date("2026-09-20"),
      reason: "ธุระส่วนตัว",
      status: "PENDING",
    },
  });

  await prisma.timeAttestation.create({
    data: {
      requesterId: thanakorn.id,
      date: today,
      type: "FORGOT_CHECKIN",
      requestedTime: "08:25",
      reason: "มือถือแบตหมดระหว่างเดินทางมาที่ทำงาน",
      status: "PENDING",
    },
  });

  console.log("Seed complete. Login as admin@university.ac.th / password123 (all seeded users share this password).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
