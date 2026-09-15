/**
 * Calibrated equipment, and when it stops being trustworthy.
 *
 * A torque wrench, a pressure gauge, a welding machine, a lifting accessory.
 * Each is one physical thing with a serial number, which is what separates it
 * from stock: five hundred metres of cable is a quantity, and a torque wrench
 * is an individual with its own history and its own certificate.
 *
 * Why the block is derived and never stored (INV-13)
 * --------------------------------------------------
 * A calibration expires on a date. If the block were a flag somebody had to set
 * when that date passed, the flag would be wrong on exactly the day it mattered
 * — nobody sets a flag on a Friday for a certificate that lapses on Saturday.
 * So availability is worked out from the certificate every time it is asked
 * for, and there is no state to forget.
 *
 * A reading taken with an instrument whose certificate expired last month is
 * not a reading. It is a number, and the difference only becomes visible when a
 * client's inspector asks for the certificate.
 *
 * What blocks it
 * --------------
 * Expired, failed its last calibration, away being calibrated, or withdrawn.
 * All four mean the same thing to the person trying to sign it out, so all four
 * produce the same refusal with a different reason.
 *
 * Not server-only: the screens sort and warn with this.
 */

export const EQUIPMENT_STATUSES = ["In service", "Out for calibration", "Under repair", "Withdrawn"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_HELP: Record<string, string> = {
  "In service": "With us and usable, as long as its calibration is in date.",
  "Out for calibration": "Away being calibrated. It cannot be issued while it is not here.",
  "Under repair": "Being fixed. Not usable until it comes back and is calibrated again.",
  Withdrawn: "Taken out of service for good. Kept on the register so its history still makes sense.",
};

export const CALIBRATION_RESULTS = ["Passed", "Failed"] as const;

export const CALIBRATION_RESULT_HELP: Record<string, string> = {
  Passed: "In tolerance. The certificate runs from the calibration date to the date it expires.",
  Failed: "Out of tolerance. It cannot be used until it has been adjusted or repaired and calibrated again.",
};

/** How long before expiry somebody should be warned, when nothing else says. */
export const DEFAULT_WARNING_DAYS = 30;

const dayMs = 86_400_000;

const startOfDay = (d: Date | string): Date => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

export type CalibrationLike = {
  result: string;
  /** The day the certificate stops being valid. */
  validTo?: Date | string | null;
  calibratedOn?: Date | string | null;
};

export type EquipmentLike = {
  status: string;
  requiresCalibration: boolean;
  /** The most recent calibration, whatever its result. */
  latest?: CalibrationLike | null;
};

export type EquipmentState = {
  /** Can it be signed out right now. */
  available: boolean;
  /** Why not, in words somebody can act on. Empty when it is available. */
  reason: string;
  /** Days until the certificate expires. Negative once it has. */
  daysToExpiry: number | null;
  expired: boolean;
  /** In date, but not for much longer. */
  expiringSoon: boolean;
  /** Needs calibrating and has never had one recorded. */
  neverCalibrated: boolean;
  validTo: Date | null;
};

/**
 * Whether a piece of equipment can be used, and why not.
 *
 * Worked out from the certificate and the status every time, so the answer is
 * right on the day the certificate lapses without anybody having done anything.
 */
export function equipmentState(
  e: EquipmentLike,
  asAt: Date = new Date(),
  warningDays: number = DEFAULT_WARNING_DAYS,
): EquipmentState {
  const today = startOfDay(asAt);

  const base: EquipmentState = {
    available: true,
    reason: "",
    daysToExpiry: null,
    expired: false,
    expiringSoon: false,
    neverCalibrated: false,
    validTo: null,
  };

  // Where it is beats what its certificate says: a wrench in a calibration lab
  // cannot be signed out however valid its paperwork.
  if (e.status === "Out for calibration") {
    return { ...base, available: false, reason: "It is away being calibrated." };
  }
  if (e.status === "Under repair") {
    return { ...base, available: false, reason: "It is under repair." };
  }
  if (e.status === "Withdrawn") {
    return { ...base, available: false, reason: "It has been withdrawn from service." };
  }

  if (!e.requiresCalibration) return base;

  if (!e.latest) {
    return {
      ...base,
      available: false,
      neverCalibrated: true,
      reason: "It needs calibration and none has been recorded. Calibrate it before it is used.",
    };
  }

  if (e.latest.result === "Failed") {
    return {
      ...base,
      available: false,
      reason: "It failed its last calibration. It has to be adjusted or repaired and calibrated again.",
    };
  }

  if (!e.latest.validTo) {
    return {
      ...base,
      available: false,
      reason: "Its last calibration has no expiry date recorded, so nobody can say whether it is still in date.",
    };
  }

  const validTo = startOfDay(e.latest.validTo);
  const days = Math.round((validTo.getTime() - today.getTime()) / dayMs);

  if (days < 0) {
    return {
      ...base,
      available: false,
      expired: true,
      daysToExpiry: days,
      validTo,
      reason: `Its calibration expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago. Send it for calibration before it is used again.`,
    };
  }

  return {
    ...base,
    daysToExpiry: days,
    validTo,
    expiringSoon: days <= warningDays,
  };
}

/**
 * Whether a piece of equipment can be signed out (INV-13).
 *
 * The refusal names the reason rather than simply saying no, because the person
 * holding it needs to know whether to wait for a certificate, find another one,
 * or send this one away.
 */
export function checkIssue(
  e: EquipmentLike,
  label = "this equipment",
  asAt: Date = new Date(),
): { ok: true } | { ok: false; error: string } {
  const state = equipmentState(e, asAt);
  if (state.available) return { ok: true };
  return { ok: false, error: `${label} cannot be issued. ${state.reason}` };
}

/**
 * When the next certificate should run to.
 *
 * From the calibration date rather than from today, because a certificate
 * issued for work done last week runs from when the work was done. Counting
 * from today would quietly extend every certificate by however long the
 * paperwork took to arrive.
 */
export function expiryFrom(calibratedOn: Date | string, months: number): Date {
  const from = startOfDay(calibratedOn);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + Math.max(1, Math.round(months)));
  // Landing on a day the target month does not have rolls into the next one,
  // which would hand out a certificate a day or three longer than it should be.
  if (to.getUTCDate() !== from.getUTCDate()) to.setUTCDate(0);
  return to;
}

export type EquipmentRow = EquipmentLike & {
  id: string;
  serialNo: string;
  description: string;
};

export type CalibrationTotals = {
  equipment: number;
  available: number;
  blocked: number;
  expired: number;
  expiringSoon: number;
  neverCalibrated: number;
  outForCalibration: number;
};

export function summariseCalibration(
  rows: EquipmentRow[],
  asAt: Date = new Date(),
  warningDays: number = DEFAULT_WARNING_DAYS,
): CalibrationTotals {
  const t: CalibrationTotals = {
    equipment: rows.length,
    available: 0,
    blocked: 0,
    expired: 0,
    expiringSoon: 0,
    neverCalibrated: 0,
    outForCalibration: 0,
  };
  for (const r of rows) {
    const s = equipmentState(r, asAt, warningDays);
    if (s.available) t.available += 1;
    else t.blocked += 1;
    if (s.expired) t.expired += 1;
    if (s.expiringSoon) t.expiringSoon += 1;
    if (s.neverCalibrated) t.neverCalibrated += 1;
    if (r.status === "Out for calibration") t.outForCalibration += 1;
  }
  return t;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence at the top of the register (INV-17).
 *
 * Expired equipment leads, because it is the only state where somebody may
 * already have used it believing it was fine.
 */
export function calibrationVerdict(
  rows: EquipmentRow[],
  asAt: Date = new Date(),
  warningDays: number = DEFAULT_WARNING_DAYS,
): string {
  if (!rows.length) return "No equipment on the register. Add the tools and instruments that carry a serial number.";

  const t = summariseCalibration(rows, asAt, warningDays);

  if (t.expired > 0) {
    return `${plural(t.expired, "item is", "items are")} out of calibration and blocked from use. Anything measured with them since they lapsed is worth checking.`;
  }
  if (t.neverCalibrated > 0) {
    return `${plural(t.neverCalibrated, "item needs", "items need")} calibration and has never had one recorded, so none of them can be used yet.`;
  }
  if (t.expiringSoon > 0) {
    return `${plural(t.expiringSoon, "item is", "items are")} due for calibration within ${warningDays} days. Book them in before they lapse.`;
  }
  if (t.outForCalibration > 0) {
    return `${plural(t.outForCalibration, "item is", "items are")} away being calibrated. Everything else on the register is in date.`;
  }
  return `All ${plural(t.equipment, "item")} on the register are in date and available.`;
}

/**
 * Worst first.
 *
 * Expired leads, then never calibrated, then whatever lapses soonest. An
 * available item with months to run sinks to the bottom, which is where it
 * belongs on a screen somebody opens to find a problem.
 */
export function rankEquipment<T extends EquipmentRow>(
  rows: T[],
  asAt: Date = new Date(),
  warningDays: number = DEFAULT_WARNING_DAYS,
): T[] {
  const rank = (r: T) => {
    const s = equipmentState(r, asAt, warningDays);
    if (s.expired) return 0;
    if (s.neverCalibrated) return 1;
    if (!s.available) return 2;
    if (s.expiringSoon) return 3;
    return 4;
  };
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const da = equipmentState(a, asAt, warningDays).daysToExpiry;
    const dbb = equipmentState(b, asAt, warningDays).daysToExpiry;
    if (da !== null && dbb !== null && da !== dbb) return da - dbb;
    return a.serialNo.localeCompare(b.serialNo);
  });
}
