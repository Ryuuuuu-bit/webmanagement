import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSchedule, deleteSchedule } from "@/actions/schedule";
import { getCurrentWeekDates, toWeekdayIndex } from "@/lib/date";
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
    prisma.semester.findMany(),
  ]);

  const weekDayNumbers = getCurrentWeekDates().map((d) => d.getDate());
  const todayIndex = toWeekdayIndex(new Date());

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
          course: { code: s.course!.code, name: s.course!.name },
          room: { name: s.room!.name },
        }))}
        teachers={isAdmin ? allTeachers.map((t) => ({ id: t.id, name: t.name })) : undefined}
        selfTeacherId={isAdmin ? undefined : session!.user.id}
        courses={courses}
        rooms={rooms}
        semesters={semesters}
        weekDayNumbers={weekDayNumbers}
        todayIndex={todayIndex}
        currentUserId={session!.user.id}
        isAdmin={isAdmin}
        createSchedule={createSchedule}
        deleteSchedule={deleteSchedule}
      />
    </div>
  );
}
