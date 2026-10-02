import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import SchoolCalendar from "@/components/SchoolCalendar";
import { createSchoolEvent, updateSchoolEvent, deleteSchoolEvent } from "@/actions/calendar";
import { bangkokDateKey, pickedDateKey } from "@/lib/date";
import { keyToDate } from "@/lib/calendar";

export default async function CalendarPage({ searchParams }: { searchParams: { month?: string; site?: string } }) {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const todayKey = bangkokDateKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "") ? searchParams.month! : todayKey.slice(0, 7);

  // The grid spans up to 6 weeks around the month.
  const [y, m] = month.split("-").map(Number);
  const from = keyToDate(new Date(Date.UTC(y, m - 1, 1 - 7)).toISOString().slice(0, 10));
  const to = keyToDate(new Date(Date.UTC(y, m, 7)).toISOString().slice(0, 10));

  const sites = await prisma.campusLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const siteFilter = isAdmin && sites.some((s) => s.id === searchParams.site) ? searchParams.site! : "";

  // Teachers see school-wide events plus those of every school they check in at.
  let siteScope: { campusLocationId: { in: string[] } | null }[] | undefined;
  if (!isAdmin) {
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { campusLocationId: true, extraSites: { select: { locationId: true } } } });
    const mine = [me?.campusLocationId, ...(me?.extraSites ?? []).map((x) => x.locationId)].filter((x): x is string => !!x);
    siteScope = [{ campusLocationId: null }, { campusLocationId: { in: mine } }];
  } else if (siteFilter) {
    siteScope = [{ campusLocationId: null }, { campusLocationId: { in: [siteFilter] } }];
  }

  const events = await prisma.schoolEvent.findMany({
    where: { startDate: { lte: to }, endDate: { gte: from }, ...(siteScope ? { OR: siteScope } : {}) },
    include: { campusLocation: { select: { name: true } } },
    orderBy: [{ startDate: "asc" }, { title: "asc" }],
  });

  return (
    <SchoolCalendar
      month={month}
      todayKey={todayKey}
      events={events.map((e) => ({
        id: e.id,
        title: e.title,
        detail: e.detail,
        start: pickedDateKey(e.startDate),
        end: pickedDateKey(e.endDate),
        isHoliday: e.isHoliday,
        siteId: e.campusLocationId,
        siteName: e.campusLocation?.name ?? null,
      }))}
      sites={sites}
      siteFilter={siteFilter}
      isAdmin={isAdmin}
      createEvent={createSchoolEvent}
      updateEvent={updateSchoolEvent}
      deleteEvent={deleteSchoolEvent}
    />
  );
}
