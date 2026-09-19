import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DepartmentManagement from "@/components/DepartmentManagement";
import CourseManagement from "@/components/CourseManagement";
import RoomManagement from "@/components/RoomManagement";
import SemesterManagement from "@/components/SemesterManagement";
import { createDepartment, updateDepartment, deleteDepartment } from "@/actions/departments";
import { createCourse, updateCourse, deleteCourse } from "@/actions/courses";
import { createRoom, updateRoom, deleteRoom } from "@/actions/rooms";
import { createSemester, updateSemester, deleteSemester } from "@/actions/semesters";

export default async function MasterDataPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const [departments, courses, rooms, semesters] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    prisma.course.findMany({ orderBy: { code: "asc" } }),
    prisma.room.findMany({ orderBy: { name: "asc" } }),
    prisma.semester.findMany({ orderBy: { startDate: "desc" } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">ข้อมูลหลัก</h1>
        <p className="mt-1 text-sm text-muted">
          จัดการสาขาวิชา รายวิชา ห้อง/อาคาร และภาคเรียนได้เอง — ไม่ต้องแก้โค้ดหรือ deploy ใหม่ทุกครั้งที่เปิดเทอมหรือเพิ่มวิชา
        </p>
      </div>

      <DepartmentManagement
        departments={departments}
        createDepartment={createDepartment}
        updateDepartment={updateDepartment}
        deleteDepartment={deleteDepartment}
      />

      <CourseManagement
        courses={courses}
        createCourse={createCourse}
        updateCourse={updateCourse}
        deleteCourse={deleteCourse}
      />

      <RoomManagement
        rooms={rooms}
        createRoom={createRoom}
        updateRoom={updateRoom}
        deleteRoom={deleteRoom}
      />

      <SemesterManagement
        semesters={semesters.map((s) => ({
          id: s.id,
          name: s.name,
          startDate: s.startDate.toISOString(),
          endDate: s.endDate.toISOString(),
        }))}
        createSemester={createSemester}
        updateSemester={updateSemester}
        deleteSemester={deleteSemester}
      />
    </div>
  );
}
