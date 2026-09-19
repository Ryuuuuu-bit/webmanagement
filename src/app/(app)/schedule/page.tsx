import { Fragment } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSchedule, deleteSchedule } from "@/actions/schedule";
import { DAY_LABELS, PERIOD_LABELS } from "@/lib/date";
import ScheduleForm from "@/components/ScheduleForm";
import DeleteButton from "@/components/DeleteButton";

export default async function SchedulePage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";

  const teacherFilter = isAdmin ? {} : { teacherId: session!.user.id };
  const schedules = await prisma.schedule.findMany({
    where: teacherFilter,
    include: { teacher: true, course: true, room: true },
    orderBy: [{ teacherId: "asc" }, { dayOfWeek: "asc" }, { periodIndex: "asc" }],
  });

  const teachers = isAdmin ? Array.from(new Map(schedules.map((s) => [s.teacher!.id, s.teacher!])).values()) : [session!.user];
  const allTeachers = isAdmin ? await prisma.user.findMany({ where: { role: "MEMBER" } }) : [];

  const [courses, rooms, semesters] = await Promise.all([
    prisma.course.findMany(),
    prisma.room.findMany(),
    prisma.semester.findMany(),
  ]);

  const grid = (teacherId: string) =>
    schedules.filter((s) => s.teacherId === teacherId);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">เพิ่มตารางสอน</h2>
        <p className="mb-3 text-sm text-black/50">
          {isAdmin
            ? "ระบบตรวจสอบการจองซ้ำซ้อนของอาจารย์และห้องให้อัตโนมัติ (FR-15)"
            : "เพิ่มคาบสอนของตัวเองได้ — ระบบตรวจสอบการจองซ้ำซ้อนกับอาจารย์และห้องอื่นให้อัตโนมัติ (FR-15)"}
        </p>
        <ScheduleForm
          action={createSchedule}
          teachers={isAdmin ? allTeachers.map((t) => ({ id: t.id, name: t.name })) : undefined}
          selfTeacherId={isAdmin ? undefined : session!.user.id}
          courses={courses}
          rooms={rooms}
          semesters={semesters}
        />
      </div>

      {(isAdmin ? allTeachers.map((t) => t) : [session!.user]).map((t) => {
        const rows = grid(t.id);
        return (
          <div key={t.id} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            {isAdmin && <div className="mb-3 font-semibold">{t.name}</div>}
            <div className="grid grid-cols-6 gap-2 text-xs">
              <div />
              {DAY_LABELS.map((d) => (
                <div key={d} className="text-center font-semibold text-black/50">{d}</div>
              ))}
              {PERIOD_LABELS.map((p, pi) => (
                <Fragment key={`row-${pi}`}>
                  <div className="pt-2 font-mono text-[11px] text-black/40">{p}</div>
                  {DAY_LABELS.map((_, di) => {
                    const s = rows.find((r) => r.dayOfWeek === di && r.periodIndex === pi);
                    return (
                      <div key={`${pi}-${di}`} className={`min-h-[64px] rounded-lg border p-2 ${s ? "border-brand/30 bg-brand-soft" : "border-dashed border-black/10"}`}>
                        {s && (
                          <div className="flex h-full flex-col justify-between">
                            <div>
                              <div className="text-[11px] font-semibold text-brand-ink">{s.course!.code}</div>
                              <div className="text-[10px] text-black/60">{s.room!.name}</div>
                            </div>
                            {(isAdmin || s.teacherId === session!.user.id) && (
                              <DeleteButton action={deleteSchedule.bind(null, s.id)} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
