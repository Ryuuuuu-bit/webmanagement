import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import SchoolCalendar, { type SchoolEventRow } from "@/components/SchoolCalendar";
import SchoolCalendarYear from "@/components/SchoolCalendarYear";
import CalendarToolbar from "@/components/CalendarToolbar";
import { createSchoolEvent, updateSchoolEvent, deleteSchoolEvent, importSchoolEvents, copySchoolEventsToNextYear } from "@/actions/calendar";
import { bangkokDateKey, pickedDateKey } from "@/lib/date";
import { eventSiteIds, eventsForSites, keyToDate } from "@/lib/calendar";
import { eachDayKey, holidayFor, loadWorkCalendar, weekdayOfKey } from "@/lib/workdays";

/**
 * "ปฏิทินโรงเรียน": month grid or a whole-year view. Admin manages events
 * (per school, several schools or all), imports a year plan from Excel,
 * adds public holidays, copies last year and exports to Excel; teachers see
 * their own schools' events read-only.
 */
export default async function CalendarPage({ searchParams }: { searchParams: { month?: string; year?: string; view?: string; site?: string } }) {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const todayKey = bangkokDateKey();
  const view = searchParams.view === "year" ? "year" : "month";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "") ? searchParams.month! : todayKey.slice(0, 7);
  const year = /^\d{4}$/.test(searchParams.year ?? "") ? Number(searchParams.year) : Number((view === "month" ? month : todayKey).slice(0, 4));

  const allSites = await prisma.campusLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const siteFilter = isAdmin && allSites.some((s) => s.id === searchParams.site) ? searchParams.site! : "";

  // Which schools this viewer sees: Admin all (or the filtered one), a
  // teacher their primary + extra sites.
  let scopeSites: string[] | null = null;
  if (!isAdmin) {
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { campusLocationId: true, extraSites: { select: { locationId: true } } } });
    scopeSites = [me?.campusLocationId, ...(me?.extraSites ?? []).map((x) => x.locationId)].filter((x): x is string => !!x);
  } else if (siteFilter) {
    scopeSites = [siteFilter];
  }
  const sites = scopeSites ? allSites.filter((s) => scopeSites!.includes(s.id)) : allSites;
  const siteName = new Map(allSites.map((s) => [s.id, s.name]));

  let from: string;
  let to: string;
  if (view === "year") {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  } else {
    const [y, m] = month.split("-").map(Number);
    from = new Date(Date.UTC(y, m - 1, 1 - 7)).toISOString().slice(0, 10);
    to = new Date(Date.UTC(y, m, 7)).toISOString().slice(0, 10);
  }
  const rows = await prisma.schoolEvent.findMany({
    where: { startDate: { lte: keyToDate(to) }, endDate: { gte: keyToDate(from) }, ...(scopeSites ? eventsForSites(scopeSites) : {}) },
    orderBy: [{ startDate: "asc" }, { title: "asc" }],
  });
  const events: SchoolEventRow[] = rows.map((e) => {
    const ids = eventSiteIds(e).filter((id) => siteName.has(id));
    return {
      id: e.id,
      title: e.title,
      detail: e.detail,
      start: pickedDateKey(e.startDate),
      end: pickedDateKey(e.endDate),
      isHoliday: e.isHoliday,
      siteIds: ids,
      siteNames: ids.map((id) => siteName.get(id)!),
    };
  });

  // Year view: work days / holidays per school for the year.
  let summary: { siteId: string; name: string; workdays: number; holidays: number; weekendDays: number }[] = [];
  if (view === "year") {
    const cal = await loadWorkCalendar(from, to);
    const days = eachDayKey(from, to);
    summary = sites.map((s) => {
      let workdays = 0;
      let holidays = 0;
      let weekendDays = 0;
      for (const k of days) {
        if (!cal.weekdays.has(weekdayOfKey(k))) weekendDays++;
        else if (holidayFor(cal, k, s.id)) holidays++;
        else workdays++;
      }
      return { siteId: s.id, name: s.name, workdays, holidays, weekendDays };
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <CalendarToolbar
        view={view}
        month={month}
        year={year}
        siteFilter={siteFilter}
        sites={allSites}
        isAdmin={isAdmin}
        importEvents={importSchoolEvents}
        copyYear={copySchoolEventsToNextYear}
      />
      {view === "year" ? (
        <SchoolCalendarYear year={year} todayKey={todayKey} events={events} summary={summary} siteFilter={siteFilter} isAdmin={isAdmin} />
      ) : (
        <SchoolCalendar
          month={month}
          todayKey={todayKey}
          events={events}
          sites={allSites}
          siteFilter={siteFilter}
          isAdmin={isAdmin}
          createEvent={createSchoolEvent}
          updateEvent={updateSchoolEvent}
          deleteEvent={deleteSchoolEvent}
        />
      )}
    </div>
  );
}
