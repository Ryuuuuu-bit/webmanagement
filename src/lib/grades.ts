import type { GradeLevel } from "@prisma/client";

/** Grade bands in display order (labels: dict.grades). */
export const GRADE_LEVELS: GradeLevel[] = ["KG", "P1_3", "P4_6", "M1_3", "M4_6"];

export function parseGradeLevel(v: unknown): GradeLevel | null {
  return GRADE_LEVELS.includes(v as GradeLevel) ? (v as GradeLevel) : null;
}

export function parseGradeLevels(values: unknown[]): GradeLevel[] {
  return GRADE_LEVELS.filter((g) => values.includes(g));
}
