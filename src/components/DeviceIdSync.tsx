"use client";

import { useEffect } from "react";
import { getDeviceId } from "@/lib/deviceId";

/** Mounted once in the root layout: makes sure the device-id cookie exists before any login/check-in request. */
export default function DeviceIdSync() {
  useEffect(() => {
    getDeviceId();
  }, []);
  return null;
}
