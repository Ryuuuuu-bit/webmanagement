import { prisma } from "./prisma";

export type CheckinPolicy = {
  requireBiometricCheckin: boolean;
  requireSelfieCheckin: boolean;
  deviceApprovalRequired: boolean;
  selfieRetentionDays: number;
};

export const DEFAULT_POLICY: CheckinPolicy = {
  requireBiometricCheckin: true,
  requireSelfieCheckin: true,
  deviceApprovalRequired: true,
  selfieRetentionDays: 90,
};

/** The single AppSetting row (created with defaults on first read). */
export async function getCheckinPolicy(): Promise<CheckinPolicy> {
  const row = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  return {
    requireBiometricCheckin: row.requireBiometricCheckin,
    requireSelfieCheckin: row.requireSelfieCheckin,
    deviceApprovalRequired: row.deviceApprovalRequired,
    selfieRetentionDays: row.selfieRetentionDays,
  };
}
