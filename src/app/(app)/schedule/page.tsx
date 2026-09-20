import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createSchedule, deleteSchedule, updateScheduleNote } from "@/actions/schedule";
import ScheduleCalendar from "@/components/ScheduleCalendar";

export default async function SchedulePage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";

  const teacherFilter = isAdmin ? {} : { teacherId: session.user.id };
  const [schedules, allTeachers, courses, rooms, semesters] = await Promise.all([
    prisma.schedule.findMany({
      where: teacherFilter,
      include: { course: true, room: true },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    // Every teacher (admin: all; member: self) with their site, so the room
    // picker can hide rooms at other branches.
    isAdmin
      ? prisma.user.findMany({ where: { role: "MEMBER", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, campusLocationId: true } })
      : prisma.user.findMany({ where: { id: session.user.id }, select: { id: true, name: true, campusLocationId: true } }),
    prisma.course.findMany(),
    prisma.room.findMany({ include: { campusLocation: { select: { name: true } } }, orderBy: [{ building: "asc" }, { name: "asc" }] }),
    prisma.semester.findMany({ orderBy: { startDate: "desc" } }),
  ]);

  // Week navigation, today/now highlighting and view switching all happen
  // client-side (browser local time, like Teams) — the server just supplies
  // the semester date ranges so the calendar can show each class only on
  // dates inside its semester.
  return (
    <div className="flex flex-col gap-6">
      <ScheduleCalendar
        schedules={schedules.map((s) => ({
          id: s.id,
          teacherId: s.teacherId,
          courseId: s.courseId,
          roomId: s.roomId,
          semesterId: s.semesterId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          note: s.note,
          course: { code: s.course!.code, name: s.course!.name },
          room: { name: s.room!.name },
        }))}
        teachers={allTeachers.map((t) => ({ id: t.id, name: t.name, campusLocationId: t.campusLocationId ?? null }))}
        selfTeacherId={isAdmin ? undefined : session.user.id}
        courses={courses}
        rooms={rooms.map((r) => ({ id: r.id, name: r.name, building: r.building, campusLocationId: r.campusLocationId ?? null, siteName: r.campusLocation?.name ?? null }))}
        semesters={semesters.map((s) => ({
          id: s.id,
          name: s.name,
          startDate: s.startDate.toISOString(),
          endDate: s.endDate.toISOString(),
        }))}
        currentUserId={session.user.id}
        isAdmin={isAdmin}
        createSchedule={createSchedule}
        updateScheduleNote={updateScheduleNote}
        deleteSchedule={deleteSchedule}
      />
    </div>
  );
}
