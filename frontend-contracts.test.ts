import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLOCKS, ISSUE_CATALOG, ROOM_TYPES } from "../shared/campus";
import { SUPPORT_EMAIL, SUPPORT_EMAIL_COMPOSE_URL } from "../shared/support";

describe("frontend contracts", () => {
  it("includes additional campus and hostel issue categories", () => {
    const values = ISSUE_CATALOG.map((item) => item.value);
    expect(values).toEqual(expect.arrayContaining([
      "Road / pathway damage",
      "Security / safety concern",
      "Classroom / lab equipment",
      "Room lock / key",
      "Hot water / bathroom",
      "Hostel internet",
    ]));
  });

  it("includes the requested campus blocks and an Others option", () => {
    expect(BLOCKS).toEqual(expect.arrayContaining([
      "AB-1", "AB-2", "AB-3", "AB-4", "AB-5",
      "MAB-1", "MAB-2", "MAB-3", "MAB-4",
      "Administrative Block", "Library", "North Square", "Gazebo", "Others",
    ]));
  });

  it("contains the complete requested Room type catalog", () => {
    expect(ROOM_TYPES).toEqual([
      "2-AC (Veg Mess)", "2-AC (Non-Veg Mess)", "2-AC (Special Mess)",
      "3-AC (Veg Mess)", "3-AC (Non-Veg Mess)", "3-AC (Special Mess)",
      "4-AC (Veg Mess)", "4-AC (Non-Veg Mess)", "4-AC (Special Mess)",
      "2-Non AC (Veg Mess)", "2-Non AC (Non-Veg Mess)", "2-Non AC (Special Mess)",
      "3-Non AC (Veg Mess)", "3-Non AC (Non-Veg Mess)", "3-Non AC (Special Mess)",
      "4-Non AC (Veg Mess)", "4-Non AC (Non-Veg Mess)", "4-Non AC (Special Mess)",
    ]);
  });

  it("targets the requested support email in a Gmail compose URL", () => {
    expect(SUPPORT_EMAIL).toBe("sushantchoudhary271008@gmail.com");
    expect(SUPPORT_EMAIL_COMPOSE_URL).toContain("view=cm");
    expect(SUPPORT_EMAIL_COMPOSE_URL).toContain(`to=${SUPPORT_EMAIL}`);
  });

  it("keeps the notification popup fixed to the viewport with its existing anchor offsets", () => {
    const css = readFileSync(fileURLToPath(new URL("../client/src/index.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.notification-popover \{[^}]*position: fixed;[^}]*right: 41px;[^}]*top: 63px;/);
  });

  it("routes Latest Signals complaint cards to the exact parameterized tracking route", () => {
    const app = readFileSync(fileURLToPath(new URL("../client/src/App.tsx", import.meta.url)), "utf8");
    const home = readFileSync(fileURLToPath(new URL("../client/src/pages/StudentHome.tsx", import.meta.url)), "utf8");
    expect(home).toContain("href={`/student/reports/${report.id}`}");
    expect(app.indexOf('path="/student/reports/:id"')).toBeGreaterThan(-1);
    expect(app.indexOf('path="/student/reports/:id"')).toBeLessThan(app.indexOf('path="/student/reports"'));
  });

  it("bounds Admin notification scrolling without changing the Student notification selector", () => {
    const css = readFileSync(fileURLToPath(new URL("../client/src/index.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.shared-notification-panel \{ max-height: calc\(100vh - 80px\); \}/);
    expect(css).toMatch(/\.shared-notification-panel \.notification-panel-list \{[^}]*max-height: min\(420px, calc\(100vh - 140px\)\);[^}]*overscroll-behavior: contain;/);
  });

  it("keeps student tracking at exactly four stages and records Admin first view idempotently", () => {
    const home = readFileSync(fileURLToPath(new URL("../client/src/pages/StudentHome.tsx", import.meta.url)), "utf8");
    const db = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
    const admin = readFileSync(fileURLToPath(new URL("./routers.ts", import.meta.url)), "utf8");
    expect(home).toContain('const statusLabels = ["submitted", "reviewed", "assigned", "completed"]');
    expect(home).toContain('grid grid-cols-4');
    expect(home).not.toContain('statusLabels = ["submitted", "reviewed", "assigned", "in_progress", "completed"]');
    expect(db).toContain('eq(reports.status, "submitted")');
    expect(admin).toContain("const wasSubmitted = report.status === \"submitted\"");
  });

  it("provides direct Back links from both login pages to role selection", () => {
    const admin = readFileSync(fileURLToPath(new URL("../client/src/pages/AdminPortal.tsx", import.meta.url)), "utf8");
    const student = readFileSync(fileURLToPath(new URL("../client/src/pages/StudentAuth.tsx", import.meta.url)), "utf8");
    expect(admin).toContain('href="/" className="secondary-button relative -top-2 inline-flex items-center gap-2"');
    expect(student).toContain('href="/" className="mb-6 inline-flex items-center gap-2');
  });

  it("uses the shared Admin C mark in the Student top-left header", () => {
    const admin = readFileSync(fileURLToPath(new URL("../client/src/pages/AdminPortal.tsx", import.meta.url)), "utf8");
    const studentShell = readFileSync(fileURLToPath(new URL("../client/src/components/StudentShell.tsx", import.meta.url)), "utf8");
    const logo = "/manus-storage/campus-scope-mark_5e3dd8a9.png";
    expect(admin).toContain(`const LOGO = "${logo}"`);
    expect(studentShell).toContain(`src="${logo}"`);
    expect(studentShell).not.toContain("rounded-full border-2 border-current");
  });
});
