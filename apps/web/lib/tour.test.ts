import { describe, expect, it } from "vitest";
import type { OnboardingStatus, OnboardingSteps } from "./idest";
import {
  NEEDS_ASSIGNMENT,
  NEEDS_CLASS,
  TOUR_STEPS,
  checklistRows,
  classTabFromParam,
  doneCount,
  isTourStepId,
  tourHref,
  type TourStepId,
} from "./tour";

const ALL_IDS: TourStepId[] = [
  "create-class",
  "invite-student",
  "invite-email",
  "invite-link",
  "create-assignment",
  "open-assignment",
];

function status(
  steps: Partial<OnboardingSteps> = {},
  extra: Partial<Omit<OnboardingStatus, "steps">> = {},
): OnboardingStatus {
  return {
    steps: {
      createClass: false,
      inviteStudent: false,
      inviteLink: false,
      createAssignment: false,
      openAssignment: false,
      ...steps,
    },
    targetClassId: null,
    dismissedAt: null,
    ...extra,
  };
}

describe("TOUR_STEPS", () => {
  it("has a step number, title and body for every id", () => {
    for (const id of ALL_IDS) {
      expect(TOUR_STEPS[id].title.length).toBeGreaterThan(0);
      expect(TOUR_STEPS[id].body.length).toBeGreaterThan(0);
      expect(TOUR_STEPS[id].step).toBeGreaterThanOrEqual(1);
      expect(TOUR_STEPS[id].step).toBeLessThanOrEqual(5);
    }
  });

  it("puts both invite paths on step 2", () => {
    expect(TOUR_STEPS["invite-student"].step).toBe(2);
    expect(TOUR_STEPS["invite-email"].step).toBe(2);
  });
});

describe("isTourStepId", () => {
  it("accepts every known id", () => {
    for (const id of ALL_IDS) expect(isTourStepId(id)).toBe(true);
  });

  it("rejects unknown, empty, non-string and prototype keys", () => {
    for (const value of ["nope", "", "toString", "constructor", "__proto__", null, undefined, 42]) {
      expect(isTourStepId(value)).toBe(false);
    }
  });
});

describe("tourHref", () => {
  const withClass = status({ createClass: true, createAssignment: true }, { targetClassId: "c1" });

  it("links every step to its page with the tour param", () => {
    expect(tourHref("create-class", withClass)).toBe("/teacher/classes?tour=create-class");
    expect(tourHref("invite-student", withClass)).toBe(
      "/teacher/classes/c1?tab=students&tour=invite-student",
    );
    expect(tourHref("invite-email", withClass)).toBe("/profile?tour=invite-email");
    expect(tourHref("invite-link", withClass)).toBe("/teacher/classes/c1?tab=invites&tour=invite-link");
    expect(tourHref("create-assignment", withClass)).toBe("/teacher/assignments?tour=create-assignment");
    expect(tourHref("open-assignment", withClass)).toBe("/teacher/assignments?tour=open-assignment");
  });

  it("blocks the class steps when there is no active class", () => {
    const noClass = status();
    expect(tourHref("invite-student", noClass)).toBeNull();
    expect(tourHref("invite-link", noClass)).toBeNull();
    expect(tourHref("invite-email", noClass)).toBe("/profile?tour=invite-email");
  });

  it("blocks opening until an assignment exists", () => {
    expect(tourHref("open-assignment", status())).toBeNull();
  });

  it("escapes the class id", () => {
    expect(tourHref("invite-link", status({}, { targetClassId: "a/b" }))).toBe(
      "/teacher/classes/a%2Fb?tab=invites&tour=invite-link",
    );
  });
});

describe("checklistRows", () => {
  it("guides a brand-new teacher to create a class first", () => {
    const rows = checklistRows(status());

    expect(rows.map((r) => r.key)).toEqual([
      "createClass",
      "inviteStudent",
      "inviteLink",
      "createAssignment",
      "openAssignment",
    ]);
    expect(rows[0]!.actions[0]).toMatchObject({
      tour: "create-class",
      label: "Làm →",
      href: "/teacher/classes?tour=create-class",
      primary: true,
    });
    expect(rows[1]!.actions).toMatchObject([
      { tour: "invite-student", href: null, blockedReason: NEEDS_CLASS, primary: false },
      { tour: "invite-email", label: "hoặc gửi email mời", href: "/profile?tour=invite-email", primary: false },
    ]);
    expect(rows[2]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS });
    expect(rows[3]!.actions[0]).toMatchObject({ href: "/teacher/assignments?tour=create-assignment", primary: false });
    expect(rows[4]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_ASSIGNMENT });
  });

  it("moves the primary action to the next undone step", () => {
    const rows = checklistRows(status({ createClass: true }, { targetClassId: "c1" }));

    expect(rows[0]!.done).toBe(true);
    expect(rows[0]!.actions[0]).toMatchObject({ label: "Xem lại", primary: false });
    expect(rows[1]!.actions[0]).toMatchObject({
      tour: "invite-student",
      label: "Thêm bằng email →",
      href: "/teacher/classes/c1?tab=students&tour=invite-student",
      primary: true,
    });
  });

  it("keeps the email path open when every class is archived or deleted", () => {
    const rows = checklistRows(status({ createClass: true }, { targetClassId: null }));

    expect(rows[1]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS, primary: false });
    expect(rows[1]!.actions[1]).toMatchObject({ href: "/profile?tour=invite-email" });
    expect(rows[2]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS });
    expect(rows[3]!.actions[0]).toMatchObject({ tour: "create-assignment", primary: true });
  });

  it("offers a replay on every row once everything is done", () => {
    const rows = checklistRows(
      status(
        {
          createClass: true,
          inviteStudent: true,
          inviteLink: true,
          createAssignment: true,
          openAssignment: true,
        },
        { targetClassId: "c1" },
      ),
    );

    for (const row of rows) {
      expect(row.done).toBe(true);
      expect(row.actions[0]!.label).toBe("Xem lại");
      expect(row.actions.some((a) => a.primary)).toBe(false);
    }
    expect(rows[1]!.actions[1]!.label).toBe("hoặc gửi email mời");
  });

  it("never marks more than one action primary", () => {
    const keys: (keyof OnboardingSteps)[] = [
      "createClass",
      "inviteStudent",
      "inviteLink",
      "createAssignment",
      "openAssignment",
    ];
    for (let mask = 0; mask < 32; mask++) {
      const steps = Object.fromEntries(
        keys.map((k, i) => [k, Boolean(mask & (1 << i))]),
      ) as Partial<OnboardingSteps>;
      for (const targetClassId of [null, "c1"]) {
        const primaries = checklistRows(status(steps, { targetClassId }))
          .flatMap((r) => r.actions)
          .filter((a) => a.primary);
        expect(primaries.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("doneCount", () => {
  it("counts ticked steps", () => {
    expect(doneCount(status())).toBe(0);
    expect(doneCount(status({ createClass: true, inviteLink: true }))).toBe(2);
  });
});

describe("classTabFromParam", () => {
  it("reads a known tab", () => {
    expect(classTabFromParam("invites")).toBe("invites");
    expect(classTabFromParam("assignments")).toBe("assignments");
    expect(classTabFromParam("students")).toBe("students");
  });

  it("takes the first of a repeated param", () => {
    expect(classTabFromParam(["assignments", "invites"])).toBe("assignments");
  });

  it("falls back to students for anything else", () => {
    expect(classTabFromParam(undefined)).toBe("students");
    expect(classTabFromParam("bogus")).toBe("students");
    expect(classTabFromParam([])).toBe("students");
  });
});
