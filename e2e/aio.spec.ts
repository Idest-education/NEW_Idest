import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * Drives every AIO flow against the running stack (web 3000, API 3001,
 * ai-service + RabbitMQ) and saves light/dark screenshots of the main screens.
 *
 * Real provider calls are made: one anonymous grading, one photo transcription,
 * and a two-essay batch. Nothing is deleted.
 */

const TEACHER = "idest.teacher+clerk_test@example.com";
const MOBILE = Boolean(process.env.AIO_MOBILE);
const OUT = process.env.AIO_SHOTS ?? path.resolve(__dirname, "../.screenshots");
const UUID = "[0-9a-f-]{36}";
const require = createRequire(path.resolve(__dirname, "../apps/server/package.json"));
const ExcelJS = require("exceljs");

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const QUESTION =
  "Some people believe that universities should focus on practical workplace skills, while others think academic knowledge matters more. Discuss both views and give your opinion.";
const essay = (who: string) =>
  [
    `Universities today face a difficult choice, and ${who} believes the debate is often framed badly.`,
    "On the one hand, graduates who cannot communicate, work in a team or manage a deadline struggle in their first job,",
    "no matter how much theory they have learned. Employers often say these skills are hard to find.",
    "On the other hand, narrow training for one job ages quickly. A student who understands why a method works",
    "can adapt when the tools change, while someone trained only on today's software is lost when it is replaced.",
    "In my opinion, the best programmes combine both, teaching serious theory through projects that look like real",
    `professional problems. Universities should therefore refuse to choose and design courses where knowledge and practice support each other. (${stamp})`,
  ].join(" ");

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400); // let color transitions finish
    await page.screenshot({ path: path.join(OUT, `${name}${MOBILE ? "-mobile" : ""}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function signInAsTeacher(page: Page) {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: TEACHER });
}

test.describe.configure({ mode: "serial" });
if (MOBILE) test.use({ viewport: { width: 360, height: 780 } });

test("anonymous grading: compose, wait, read the result", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Know your Writing band/ })).toBeVisible();
  if (!MOBILE) await expect(page.getByText("Sign in for bulk grading")).toBeVisible();
  await shot(page, "home");

  await page.getByRole("button", { name: "Grade" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Add the question");

  await page.getByLabel("Question (required)").fill(QUESTION);
  await page.getByLabel("Essay", { exact: true }).fill(essay("the writer"));
  await page.getByRole("button", { name: "Grade" }).click();
  await page.waitForURL(new RegExp(`/r/${UUID}$`));

  const working = page.getByText(/Grading in progress|Reading your essay/);
  if (await working.waitFor({ timeout: 8000 }).then(() => true, () => false)) await shot(page, "result-grading");

  await expect(page.getByText("Overall band")).toBeVisible({ timeout: 170_000 });
  await expect(page.getByText("AI assessment")).toBeVisible();
  for (const c of ["TR", "CC", "LR", "GRA"]) await expect(page.locator("abbr", { hasText: c })).toBeVisible();
  await shot(page, "result-scored");

  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: /Io looked everywhere/ })).toBeVisible();
  await shot(page, "not-found");
});

test("photo transcription fills the essay and must be checked", async ({ page, browser }) => {
  // A "handwritten" page, rendered here so the test needs no fixture file.
  const paper = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await paper.setContent(
    `<body style="margin:0;background:#fffdf6;font:34px/1.7 'Bradley Hand','Segoe Print',cursive;padding:60px;color:#1d2a4d">${essay(
      "my teacher",
    )}</body>`,
  );
  const photo = await paper.screenshot();
  await paper.close();

  await page.goto("/");
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "page-1.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByText("Reading your photos.")).toBeVisible();
  const confirm = page.getByLabel("I've checked the transcript");
  await expect(confirm).toBeVisible({ timeout: 170_000 });
  await expect(page.getByLabel("Essay", { exact: true })).not.toHaveValue("");

  await page.getByLabel("Question (required)").fill(QUESTION);
  await page.getByRole("button", { name: "Grade" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("tick the box");
  await confirm.check();
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

test("teacher batch: Excel in, grades, review, finalize, reasons, Excel out", async ({ page }) => {
  test.setTimeout(480_000);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Class 10A");
  sheet.addRow(["Student", "Essay"]);
  sheet.addRow(["Nguyen An", essay("An")]);
  sheet.addRow(["Tran Binh", essay("Binh")]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

  await signInAsTeacher(page);
  await page.goto("/batches/new");
  await expect(page.getByRole("heading", { name: "Grade a whole class." })).toBeVisible();
  await page.getByLabel("Batch name").fill(`Class 10A, week 3 (${stamp})`);
  await page.getByLabel("Question").fill(QUESTION);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "class-10a.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await expect(page.getByText("class-10a.xlsx")).toBeVisible();
  await page.getByRole("button", { name: "Start grading" }).click();
  await page.waitForURL(new RegExp(`/batches/${UUID}$`));
  const batchUrl = page.url();

  await expect(page.getByText("All 2 essays graded.")).toBeVisible({ timeout: 400_000 });
  await expect(page.getByRole("link", { name: "Nguyen An" })).toBeVisible();
  await shot(page, "batch-detail");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  const file = await download;
  const saved = path.join(OUT, `scores-${stamp}.xlsx`);
  await file.saveAs(saved);
  const back = new ExcelJS.Workbook();
  await back.xlsx.readFile(saved);
  const header = (back.worksheets[0].getRow(1).values as unknown[]).map(String);
  expect(header).toEqual(expect.arrayContaining(["Student", "Essay", "Overall", "Task Response", "Grading status"]));
  expect(Number(back.worksheets[0].getRow(2).getCell(header.indexOf("Overall")).value)).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Nguyen An" }).click();
  await page.waitForURL(new RegExp(`/review/${UUID}$`));
  const raise = page.getByRole("button", { name: "Raise Task Response" });
  await expect(raise).toBeVisible();
  await shot(page, "review");

  if (await raise.isDisabled()) await page.getByRole("button", { name: "Lower Task Response" }).click();
  else await raise.click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft 1 saved/)).toBeVisible();
  await page.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByText(/Finalized .*Reopen to make changes/)).toBeVisible();

  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Finalize" })).toBeVisible();
  await page.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByText(/Reopen to make changes/)).toBeVisible();
  await shot(page, "review-finalized");

  await page.goto(batchUrl);
  await expect(page.getByText("1 finalized")).toBeVisible();
  await page.getByRole("button", { name: "Add reasons" }).click();
  const dialog = page.getByRole("dialog", { name: "Why did you change these scores?" });
  await dialog.getByLabel("AI was too harsh").check();
  await dialog.getByRole("button", { name: /^Tag/ }).click();
  await expect(page.getByRole("button", { name: "Add reasons" })).toHaveCount(0);
});

test("teacher history lists single gradings", async ({ page }) => {
  await signInAsTeacher(page);
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
});
