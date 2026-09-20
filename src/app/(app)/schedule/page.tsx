import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSchedule, deleteSchedule, updateScheduleNote } from "@/actions/schedule";
import ScheduleCalendar from "@/components/ScheduleCalendar";

export default async function SchedulePage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";

  const teacherFilter = isAdmin ? {} : { teacherId: session!.user.id };
  const [schedules, allTeachers, courses, rooms, semesters] = await Promise.all([
    prisma.schedule.findMany({
      where: teacherFilter,
      include: { course: true, room: true },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    isAdmin ? prisma.user.findMany({ where: { role: "MEMBER" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.course.findMany(),
    prisma.room.findMany(),
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
        teachers={isAdmin ? allTeachers.map((t) => ({ id: t.id, name: t.name })) : undefined}
        selfTeacherId={isAdmin ? undefined : session!.user.id}
        courses={courses}
        rooms={rooms}
        semesters={semesters.map((s) => ({
          id: s.id,
          name: s.name,
          startDate: s.startDate.toISOString(),
          endDate: s.endDate.toISOString(),
        }))}
        currentUserId={session!.user.id}
        isAdmin={isAdmin}
        createSchedule={createSchedule}
        updateScheduleNote={updateScheduleNote}
        deleteSchedule={deleteSchedule}
      />
    </div>
  );
}
