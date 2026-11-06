import { describe, expect, it } from "vitest";
import { decideAutonomy, inSendWindow, nextSendTime, type AutonomySettings } from "@/features/agent/autonomy";

const base: AutonomySettings = {
  level: "autonomous", paused: false, maxOfferHt: "15000.00", requireDiscountApproval: false, dailySendLimit: 200,
  sendWindow: { days: [1, 2, 3, 4, 5], start: "08:30", end: "18:30" }, timezone: "Europe/Paris",
};
const reply = { kind: "reply" as const, intent: "objection", objection: "too_expensive", escalate: false, discountPct: null, guardNotes: [], identityVerified: true, injectionSuspected: false };
const offer = { kind: "offer_email" as const, offerTotalHt: "8615.49", discountPct: 0, guardNotes: [], identityVerified: true };

describe("Règles d'autonomie", () => {
  it("supervisé ou suspendu : toujours une validation", () => {
    expect(decideAutonomy({ ...base, level: "supervised" }, offer).mode).toBe("approval");
    expect(decideAutonomy({ ...base, paused: true }, offer).mode).toBe("approval");
  });
  it("offre : auto sous le plafond, validation au-dessus", () => {
    expect(decideAutonomy(base, offer).mode).toBe("auto");
    expect(decideAutonomy(base, { ...offer, offerTotalHt: "15000.01" }).mode).toBe("approval");
    expect(decideAutonomy({ ...base, maxOfferHt: null }, { ...offer, offerTotalHt: "999999" }).mode).toBe("auto");
    expect(decideAutonomy(base, { ...offer, identityVerified: false }).mode).toBe("approval");
  });
  it("remise dans la politique : auto (JONAS), sauf si l'organisation exige une validation", () => {
    expect(decideAutonomy(base, { ...reply, discountPct: 1 }).mode).toBe("auto");
    expect(decideAutonomy({ ...base, requireDiscountApproval: true }, { ...reply, discountPct: 1 }).mode).toBe("approval");
    expect(decideAutonomy({ ...base, level: "semi_autonomous" }, { ...reply, discountPct: 1 }).mode).toBe("approval");
  });
  it("escalade, question ouverte, identité douteuse, injection, garde-fou : validation", () => {
    expect(decideAutonomy(base, { ...reply, escalate: true }).mode).toBe("approval");
    expect(decideAutonomy(base, { ...reply, intent: "question", objection: null }).mode).toBe("approval");
    expect(decideAutonomy(base, { ...reply, identityVerified: false }).mode).toBe("approval");
    expect(decideAutonomy(base, { ...reply, injectionSuspected: true }).mode).toBe("approval");
    expect(decideAutonomy(base, { ...reply, guardNotes: ["x"] }).mode).toBe("approval");
  });
  it("accord, rendez-vous, objection simple : auto", () => {
    for (const intent of ["accept", "meeting_request"]) expect(decideAutonomy(base, { ...reply, intent, objection: null }).mode).toBe("auto");
    expect(decideAutonomy(base, reply).mode).toBe("auto");
  });
  it("relances bornées", () => {
    expect(decideAutonomy(base, { kind: "followup", attempt: 2, maxFollowups: 2, guardNotes: [] }).mode).toBe("auto");
    expect(decideAutonomy(base, { kind: "followup", attempt: 3, maxFollowups: 2, guardNotes: [] }).mode).toBe("approval");
  });
});

describe("Plage d'envoi (Europe/Paris)", () => {
  const w = base.sendWindow;
  it("jours ouvrés, heures ouvrées", () => {
    expect(inSendWindow(new Date("2026-11-06T10:00:00Z"), w)).toBe(true); // ven. 11h
    expect(inSendWindow(new Date("2026-11-06T07:00:00Z"), w)).toBe(false); // ven. 8h
    expect(inSendWindow(new Date("2026-11-06T17:30:00Z"), w)).toBe(false); // ven. 18h30
    expect(inSendWindow(new Date("2026-11-07T10:00:00Z"), w)).toBe(false); // samedi
    expect(inSendWindow(new Date("2026-07-06T06:45:00Z"), w)).toBe(true); // lun. 8h45 heure d'été
  });
  it("prochain créneau", () => {
    expect(nextSendTime(new Date("2026-11-07T10:00:00Z"), w)!.toISOString()).toBe("2026-11-09T07:30:00.000Z");
    expect(nextSendTime(new Date("2026-11-06T10:00:00Z"), w)!.toISOString()).toBe("2026-11-06T10:00:00.000Z");
    expect(nextSendTime(new Date(), { days: [], start: "08:30", end: "18:30" })).toBeNull();
  });
});
