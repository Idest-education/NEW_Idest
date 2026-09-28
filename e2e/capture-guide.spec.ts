import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * Captures every screenshot used by docs/user-guide/huong-dan-su-dung.md by
 * driving the real running app — nothing here is staged or mocked.
 *
 * Runs in file order in one worker (see playwright.config.ts), because later
 * tests depend on state earlier ones create: a redo request unblocks a new
 * attempt, an invite token gets previewed then revoked, a freshly submitted
 * essay gets AI-scored then graded then published.
 *
 * Safety: creates a class, an assignment and an invite link prefixed
 * "Tài liệu HDSD —" so they read as documentation fixtures; never deletes,
 * truncates, or confirms an actually destructive action (a delete
 * confirmation is screenshotted, then cancelled).
 */

const STUDENT = "idest.student+clerk_test@example.com";
const TEACHER = "idest.teacher+clerk_test@example.com";
const DEMO_TEACHER = "idest.demo-teacher+clerk_test@example.com";
// Unique per run: Clerk will not re-send an invitation to an address that
// already has one pending, so a fixed address would break a repeat run.
const INVITED_EMAIL = `idest.invited-hdsd-${Date.now()}+clerk_test@example.com`;

const ASSIGNMENT_ID = "6b3b6078-d67a-475b-8745-aaf25af84b68";
const PUBLISHED_SUBMISSION_ID = "dd7b3a48-0f09-4e36-81ae-19829ff51395";

const IMAGES_DIR = path.resolve(__dirname, "..", "docs", "user-guide", "images");

test.use({ viewport: { width: 1440, height: 900 } });

// The dev stack under repeated navigation load occasionally serves a
// transient network error (Chrome's own "This page couldn't load"
// interstitial) rather than a real app response. Give every test more room
// than the shared 180s default and retry a broken navigation before it eats
// that budget.
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
});

const TOO_SHORT_ESSAY = "This is a very short draft";

// The server's submit idempotency key is derived from word count + the
// essay's first 24 characters, so a literal re-run of this suite against an
// unchanged fixed essay is treated as a retry of the SAME attempt (no new
// row) rather than a fresh one. Rotating the opening keeps repeat runs real.
const ESSAY_OPENERS = [
  "In many countries today, young people face a difficult choice about why they attend",
  "In numerous countries nowadays, young people face a real dilemma about why they attend",
  "Across many societies today, young people face a genuine dilemma about why they attend",
];

const NEW_ESSAY = [
  ESSAY_OPENERS[Date.now() % ESSAY_OPENERS.length],
  "university at all. Some argue the primary purpose is to secure a stable career,",
  "while others insist that expanding the mind matters more than any job title.",
  "I believe a well-designed university education achieves both goals at once, rather than",
  "forcing students to pick a side.",
  "Consider first the practical argument. Tuition fees and years of lost income are a",
  "genuine sacrifice, so graduates reasonably expect a return on that investment. Fields such",
  "as engineering, medicine and accounting are judged partly by how quickly their graduates",
  "find relevant work, and universities that ignore this reality risk producing frustrated alumni.",
  "Yet the case for knowledge for its own sake is equally strong. Many of history's",
  "most valuable breakthroughs, from vaccines to renewable energy, began as curiosity-driven",
  "research with no obvious commercial use. A university that only trains students for",
  "today's job market leaves them unprepared for a labour market that keeps changing.",
  "In my view, the strongest institutions blend both aims: they teach durable, transferable",
  "reasoning skills through real, practical projects. Universities should therefore resist",
  "treating employment and knowledge as opposing goals, because a rigorous education already",
  "serves both at once.",
].join(" ");

/** Next's dev-mode floating button/portal is not part of the product UI. */
async function clean(page: Page) {
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove()).catch(() => {});
}

/**
 * Every page-level list/dashboard renders a static heading immediately, then
 * fetches its data and swaps the <WaitingRack> skeleton (label "Đang lấy
 * bảng…") for real content a beat later. An `expect(heading).toBeVisible()`
 * right after navigation is satisfied by the static heading alone, so a shot
 * taken immediately after can still land on the skeleton. Wait for the
 * skeleton to be gone (a no-op where it never appeared) plus a short settle
 * for any CSS transition (tab underline, overlay fade) to finish, before
 * every single capture.
 */
async function settle(page: Page) {
  await page
    .getByText("Đang lấy bảng…")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
}

async function shot(page: Page, name: string, opts?: { fullPage?: boolean }) {
  await settle(page);
  await clean(page);
  await page.screenshot({ path: path.join(IMAGES_DIR, `${name}.png`), fullPage: opts?.fullPage ?? true });
}

/**
 * An element taller than the viewport forces Playwright to scroll-and-stitch
 * the capture; a page with a sticky header can then bleed that header into
 * the middle of the stitched image. Grow the viewport to fit the whole
 * element first so a single, unscrolled shot is enough, then restore it.
 */
async function shotEl(locator: Locator, name: string) {
  const page = locator.page();
  await settle(page);
  await clean(page);

  const original = page.viewportSize() ?? { width: 1440, height: 900 };
  const box = await locator.boundingBox().catch(() => null);
  const grown = box && box.height > original.height - 40;
  try {
    if (grown) {
      await page.setViewportSize({ width: original.width, height: Math.ceil(box!.height) + 120 });
      await page.waitForTimeout(150);
    }
    await locator.screenshot({ path: path.join(IMAGES_DIR, `${name}.png`) });
  } finally {
    if (grown) await page.setViewportSize(original);
  }
}

/** Navigates, retrying once or twice if the dev stack serves a transient network error. */
async function open(page: Page, url: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(url, { timeout: 30_000 }).catch(() => {});
    const broken = await page
      .getByRole("heading", { name: "This page couldn’t load" })
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (!broken) return;
    await page.waitForTimeout(3_000);
  }
}

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await open(page, "/");
  await clerk.signIn({ page, emailAddress });
}

/** A rail section (`<section class="...railBlock">`) identified by its heading text. */
const railBlock = (page: Page, text: string) =>
  page.locator('[class*="__railBlock"]', { hasText: text }).first();

const wizardPanel = (page: Page) => page.locator('[class*="__wizardPanel"]').first();

// ---------------------------------------------------------------------------

test("trang chủ và các biểu mẫu xác thực trống", async ({ page }) => {
  await setupClerkTestingToken({ page });

  await open(page, "/");
  await page.waitForTimeout(1500);
  await shot(page, "trang-chu");

  await open(page, "/sign-up");
  await expect(page.getByRole("heading", { name: "Tạo tài khoản của bạn" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "dang-ky-trong");

  await open(page, "/sign-in");
  await expect(page.getByRole("textbox", { name: "Địa chỉ email" })).toBeVisible({ timeout: 20_000 });
  await shot(page, "dang-nhap-trong");
});

test("bảng điều khiển của từng vai trò sau khi đăng nhập", async ({ page }) => {
  await signInAs(page, TEACHER);
  await open(page, "/teacher");
  // The "Tổng quan" heading renders before the stat tiles finish fetching;
  // wait for a tile label, which only exists once the ready state renders.
  await expect(page.getByText("Chờ AI chấm")).toBeVisible({ timeout: 20_000 });
  await shot(page, "bang-dieu-khien-giao-vien");

  await open(page, "/teacher/submissions");
  await expect(page.getByText(/\d+ bài nộp/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "danh-sach-bai-nop-tong-hop");

  await clerk.signOut({ page });
  await signInAs(page, STUDENT);
  await open(page, "/student");
  // Same story: wait for the "Lớp của tôi →" link, which only mounts once
  // the dashboard's data has actually loaded, not just the static heading.
  await expect(page.getByRole("link", { name: /Lớp của tôi/ })).toBeVisible({ timeout: 20_000 });
  await shot(page, "bang-dieu-khien-hoc-vien");

  await open(page, "/student/classes");
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Đang lấy bảng…")).toBeHidden({ timeout: 15_000 });
  await shot(page, "hoc-vien-danh-sach-lop");
});

test("giáo viên mới đăng ký thấy bảng trống", async ({ page }) => {
  await signInAs(page, DEMO_TEACHER);

  await open(page, "/welcome");
  const nameInput = page.getByRole("textbox", { name: "Tên của bạn" });
  await expect(nameInput).toBeVisible({ timeout: 20_000 });
  // Fill deterministically rather than relying on the async Clerk-profile
  // prefill effect, which may not have run yet the instant the field mounts.
  await nameInput.fill("Tài liệu HDSD — Giáo viên demo");
  await shot(page, "man-hinh-chao-mung-dat-ten");

  await page.getByRole("button", { name: "Tiếp tục →" }).click();
  await page.waitForURL("**/teacher", { timeout: 20_000 });
  await expect(page.getByText("Chờ AI chấm")).toBeVisible({ timeout: 20_000 });
  await shot(page, "bang-dieu-khien-giao-vien-moi");

  await open(page, "/teacher/classes");
  await expect(page.getByRole("heading", { name: "0 lớp" })).toBeVisible({ timeout: 15_000 });
  await shot(page, "danh-sach-lop-trong");

  await open(page, "/profile");
  await expect(page.getByText("Chưa có lớp nào.")).toBeVisible({ timeout: 15_000 });
  await shot(page, "moi-qua-lien-ket-chua-co-lop");

  // The other invite path: an email invitation for someone who has no
  // account yet at all (distinct from "add existing student by email" on a
  // class's roster). Only a genuine teacher role sees this block on /profile
  // — the admin-flavoured seed account used elsewhere in this suite does not.
  await page.locator("#invite").fill(INVITED_EMAIL);
  // The "Mời học viên qua email" heading sits in a sibling sectionHead div,
  // not inside the railBlock itself — match on a label that IS inside it.
  const inviteBlock = page.locator('[class*="__railBlock"]', { hasText: "Email học viên" }).first();
  await shotEl(inviteBlock, "moi-hoc-vien-qua-email-dien-form");
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  await expect(page.getByText(`Đã gửi lời mời tới ${INVITED_EMAIL}`)).toBeVisible({ timeout: 20_000 });
  await shotEl(inviteBlock, "da-gui-loi-moi-qua-email");
});

test("giáo viên mở lại bài đã duyệt và yêu cầu làm lại", async ({ page }) => {
  await signInAs(page, TEACHER);

  // Find the student's CURRENT latest attempt on this assignment, rather
  // than a hardcoded id: a prior run of this whole suite may have already
  // carried that fixture further (published a newer attempt), which is
  // exactly the "one open attempt at a time" rule this test is meant to
  // demonstrate — so re-deriving "latest" keeps the suite repeatable.
  await open(page, `/teacher/assignments/${ASSIGNMENT_ID}`);
  const latestRow = page.locator('a[href*="/teacher/submissions/"]').first();
  await latestRow.waitFor({ state: "visible", timeout: 15_000 });
  await latestRow.click();
  await page.waitForURL(/\/teacher\/submissions\/[0-9a-f-]{36}/, { timeout: 15_000 });

  // Anything still awaiting review is published first, so the history is
  // closed rather than abandoned.
  if (await page.getByRole("button", { name: "Duyệt điểm" }).isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Duyệt điểm" }).click();
    await expect(page.getByText(/Đã duyệt ·/)).toBeVisible({ timeout: 30_000 });
  }

  await expect(page.getByText(/Đã duyệt ·/)).toBeVisible({ timeout: 20_000 });
  await shotEl(railBlock(page, "Đã duyệt"), "bai-da-duyet-nut-mo-lai");

  await page.getByRole("button", { name: "Mở lại để sửa" }).click();
  await page.waitForTimeout(2_000);
  await page.reload();

  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
  await expect(page.getByRole("button", { name: /Yêu cầu học viên làm lại|Hủy yêu cầu/ })).toBeVisible({
    timeout: 15_000,
  });
  await shotEl(wizardPanel(page), "menu-them-truoc-khi-yeu-cau-lai");

  // A redo request may already be open from an earlier run of this suite.
  if (await page.getByRole("button", { name: "Yêu cầu học viên làm lại" }).isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Yêu cầu học viên làm lại" }).click();
    await page.locator("#redo-reason").fill(
      "Tài liệu HDSD: hãy bổ sung ví dụ cụ thể hơn ở thân bài rồi nộp lại.",
    );
    await shotEl(wizardPanel(page), "dien-ly-do-yeu-cau-lam-lai");
    await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
  }
  await expect(page.getByText(/Đã yêu cầu ·/)).toBeVisible({ timeout: 20_000 });
  await shotEl(wizardPanel(page), "da-yeu-cau-lam-lai");
});

// ---------------------------------------------------------------------------

let fixtureClassId = "";
let inviteToken = "";

test("giáo viên tạo và quản lý một lớp học", async ({ page, browser }) => {
  await signInAs(page, TEACHER);

  // Always a fresh class, never reused: the "just created, totally empty"
  // screenshot below must show 0 học viên, and a class reused across runs
  // would already carry a member added by a previous run — a real bug this
  // guide's previous draft ran straight into. One more clearly-labelled
  // fixture class per regeneration is expected and harmless (see the safety
  // rules in the capture task: "Creating classes... is fine and expected").
  // A minute-precision stamp (not a raw epoch number) keeps the name unique
  // across runs while still reading cleanly inside the screenshot itself.
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const runStamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const FIXTURE_CLASS = `Tài liệu HDSD — Lớp minh họa (${runStamp})`;

  await open(page, "/teacher/classes");
  await expect(page.getByRole("heading", { name: /\d+ lớp/ })).toBeVisible({ timeout: 15_000 });
  await shot(page, "danh-sach-lop-co-du-lieu");

  await page.getByRole("button", { name: "Tạo lớp mới" }).click();
  await page.locator("#c-name").fill(FIXTURE_CLASS);
  await page.locator("#c-desc").fill("Lớp dùng để chụp ảnh minh họa cho hướng dẫn sử dụng.");
  await shotEl(wizardPanel(page), "tao-lop-moi-dien-thong-tin");
  await page.getByRole("button", { name: "Tạo lớp", exact: true }).click();
  const classLink = page.getByText(FIXTURE_CLASS, { exact: true });
  await expect(classLink).toBeVisible({ timeout: 15_000 });
  await classLink.click();
  await page.waitForURL(/\/teacher\/classes\/[0-9a-f-]{36}/, { timeout: 15_000 });
  fixtureClassId = page.url().split("/").pop() ?? "";

  await expect(page.getByRole("tab", { name: /^Liên kết mời\s*0$/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(STUDENT)).toBeHidden();
  await shot(page, "chi-tiet-lop-moi-tao-trong");

  await page.getByRole("button", { name: "Tùy chọn lớp" }).click();
  await shotEl(page.locator('[class*="__actionMenuPanel"]').first(), "menu-tuy-chon-lop");

  await page.getByRole("button", { name: "Sửa tên/mô tả" }).click();
  await shotEl(wizardPanel(page), "sua-ten-mo-ta-lop");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.waitForTimeout(1_000);

  // Học viên tab is the default active tab, so no click is needed to reach it.
  if (!(await page.getByText(STUDENT).isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.locator("#add-member").fill(STUDENT);
    await page.getByRole("button", { name: "Thêm", exact: true }).click();
    await expect(page.getByText(STUDENT)).toBeVisible({ timeout: 15_000 });
  }
  await shot(page, "them-hoc-vien-bang-email");

  // Bài tập tab — empty for a fresh class.
  await page.getByRole("tab", { name: /^Bài tập/ }).click();
  await shot(page, "tab-bai-tap-lop-trong");

  // Liên kết mời tab — create, preview as an outsider, then revoke.
  await page.getByRole("tab", { name: /^Liên kết mời/ }).click();
  await shot(page, "tab-lien-ket-moi-trong");

  await page.getByPlaceholder("Nhãn liên kết (tùy chọn)").fill("Tài liệu HDSD — Link mời demo");
  await page.getByRole("button", { name: "Tạo liên kết mời" }).click();
  const notice = page.getByText(/Đã tạo:/);
  await expect(notice).toBeVisible({ timeout: 15_000 });
  const noticeText = (await notice.textContent()) ?? "";
  inviteToken = noticeText.match(/\/join\/([a-zA-Z0-9_-]+)/)?.[1] ?? "";
  await shot(page, "tao-lien-ket-moi-thanh-cong");

  if (inviteToken) {
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonPage = await anon.newPage();
    await setupClerkTestingToken({ page: anonPage });
    await anonPage.goto(`http://localhost:3000/join/${inviteToken}`);
    await expect(anonPage.getByText("mời bạn vào lớp")).toBeVisible({ timeout: 15_000 });
    await shot(anonPage, "trang-tham-gia-lop-qua-lien-ket");
    await anon.close();
  }

  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await page.getByRole("button", { name: "Xóa liên kết", exact: true }).click();
  await page.waitForTimeout(1_000);
  await shot(page, "sau-khi-thu-hoi-lien-ket-moi");

  if (inviteToken) {
    const anon2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonPage2 = await anon2.newPage();
    await setupClerkTestingToken({ page: anonPage2 });
    await anonPage2.goto(`http://localhost:3000/join/${inviteToken}`);
    await expect(anonPage2.getByText("đã bị thu hồi")).toBeVisible({ timeout: 15_000 });
    await shot(anonPage2, "lien-ket-moi-da-thu-hoi");
    await anon2.close();
  }

  // The real assignment's own desk: its roster of actual submissions. A
  // single-resource GET, so it does not hit the admin/pagination bug that
  // rules out this TEACHER (admin-role) account for the assignments *list*.
  await open(page, `/teacher/assignments/${ASSIGNMENT_ID}`);
  await expect(page.getByRole("heading", { name: /Universities/ })).toBeVisible({ timeout: 15_000 });
  await shot(page, "chi-tiet-bai-tap-danh-sach-bai-nop");
});

let fixtureAssignmentId = "";

test("giáo viên tạo và quản lý một bài tập", async ({ page }) => {
  // NOTE: this uses DEMO_TEACHER, not TEACHER. The seeded TEACHER account is
  // DB role "admin" (it doubles as an admin for other flows in this suite),
  // and GET /assignments?page=&limit= on the server only returns the
  // paginated {data,total,...} shape for role "teacher" — an admin falls
  // through to a plain unpaginated array, which crashes this page's
  // `assignmentPage.data.find(...)` client code. That is a real product bug
  // independent of this test; DEMO_TEACHER (a genuine "teacher" role) avoids
  // it entirely, which is also who a real pilot teacher actually is.
  await signInAs(page, DEMO_TEACHER);

  const FIXTURE_ASSIGNMENT = "Tài liệu HDSD — Bài tập minh họa";

  await open(page, "/teacher/assignments");
  await expect(page.getByRole("heading", { name: /\d+ bài tập/ })).toBeVisible({ timeout: 15_000 });
  await shot(page, "danh-sach-bai-tap");

  const card = page.locator('[class*="__paperCard"]', { hasText: FIXTURE_ASSIGNMENT });

  async function captureFixtureId() {
    const href = await card
      .locator('a[href*="/teacher/assignments/"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    fixtureAssignmentId = href?.split("/").pop() ?? "";
  }

  if (!(await card.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.getByRole("button", { name: "Giao bài tập mới" }).click();
    await page.locator("#a-title").fill(FIXTURE_ASSIGNMENT);
    await page.locator("#a-prompt").fill(
      "Some people think that the best way to increase road safety is to enforce " +
        "stricter speeding laws. To what extent do you agree or disagree?",
    );
    await shotEl(wizardPanel(page), "tao-bai-tap-buoc-1-dien-noi-dung");

    // Show the Task 1 image requirement, then switch back so this fixture needs no image.
    await page.locator("#a-type").selectOption("task_1");
    await shotEl(wizardPanel(page), "tao-bai-tap-task1-yeu-cau-anh");
    await page.locator("#a-type").selectOption("task_2");

    await page.getByRole("button", { name: "Tiếp theo →" }).click();
    // No class selected: this demo account owns no classes, so the fixture
    // is created open to all students — itself worth documenting.
    await shotEl(wizardPanel(page), "tao-bai-tap-buoc-2-lich-va-lop");

    await page.getByRole("button", { name: "Tạo bài tập (bản nháp)" }).click();
    await expect(page.getByText(FIXTURE_ASSIGNMENT)).toBeVisible({ timeout: 15_000 });
    await shot(page, "bai-tap-moi-tao-ban-nhap");
  }

  await captureFixtureId();

  if (await card.getByRole("button", { name: "Mở bài tập" }).isVisible({ timeout: 2_000 }).catch(() => false)) {
    await card.getByRole("button", { name: "Mở bài tập" }).click();
    await expect(card.getByText("Đang mở")).toBeVisible({ timeout: 15_000 });
  }
  await shotEl(card, "bai-tap-da-mo");

  if (await card.getByRole("button", { name: "Ghim nổi bật" }).isVisible({ timeout: 2_000 }).catch(() => false)) {
    await card.getByRole("button", { name: "Ghim nổi bật" }).click();
    await page.waitForTimeout(800);
  }
  await shotEl(card, "bai-tap-ghim-noi-bat");

  await card.getByRole("button", { name: "Sửa", exact: true }).click();
  await shotEl(wizardPanel(page), "sua-bai-tap");
  await page.getByRole("button", { name: "Xóa bài tập" }).click();
  await shotEl(wizardPanel(page), "xoa-bai-tap-xac-nhan");
  await page.getByRole("button", { name: "Thôi" }).click();
  await page.keyboard.press("Escape");

  await card.getByRole("button", { name: "Đóng bài tập" }).click();
  await page.waitForTimeout(800);
  await shotEl(card, "bai-tap-da-dong");

  // Leave it open again: a later test submits a real essay against this
  // fixture to capture a clean "just submitted" / "blocked from resubmitting"
  // pair with no prior redo history.
  if (await card.getByRole("button", { name: "Mở bài tập" }).isVisible({ timeout: 2_000 }).catch(() => false)) {
    await card.getByRole("button", { name: "Mở bài tập" }).click();
    await expect(card.getByText("Đang mở")).toBeVisible({ timeout: 15_000 });
  }
});

test("học viên nộp bài lần đầu rồi bị chặn nộp lại", async ({ page }) => {
  expect(fixtureAssignmentId, "bước tạo bài tập phải chạy trước").toHaveLength(36);
  await signInAs(page, STUDENT);

  // Skip cleanly if a previous run already left an open attempt here —
  // still exercises the "blocked" screenshot below either way.
  await open(page, `/student/assignments/${fixtureAssignmentId}`);
  const essay = page.locator("#essay");
  const canWrite = await essay
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (canWrite) {
    await essay.fill(
      "In many countries today, the government funds most large public infrastructure " +
        "projects, from roads and bridges to hospitals and schools. Some people believe " +
        "private companies should take on more of this responsibility instead. This essay " +
        "will discuss both sides before giving my own view. On one hand, private funding " +
        "can bring efficiency and innovation that slow public bureaucracies often lack. " +
        "Companies competing for contracts have a direct incentive to finish projects on " +
        "time and within budget, since delays cost them money. On the other hand, public " +
        "infrastructure often serves everyone regardless of ability to pay, and a purely " +
        "commercial operator may neglect routes or regions that are not profitable. In my " +
        "view, a mixed model works best: governments should set clear standards and retain " +
        "ownership of essential infrastructure, while inviting private partners to handle " +
        "construction and maintenance under contract.",
    );
    await page.getByRole("button", { name: "Nộp bài" }).click();
    await page.waitForURL(/\/student\/submissions\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText("Giáo viên đang chấm bài này")).toBeVisible({ timeout: 15_000 });
    await shot(page, "hoc-vien-vua-nop-cho-cham");
  }

  await open(page, `/student/assignments/${fixtureAssignmentId}`);
  await expect(page.getByText("Bạn đã nộp bài này")).toBeVisible({ timeout: 20_000 });
  await shot(page, "hoc-vien-khong-the-nop-lai");
});

// ---------------------------------------------------------------------------

// Falls back to the attempt already produced by an earlier partial run of
// the writing test below, so the grading/publish tests can run on their own.
let newSubmissionId = "7ebf2f6b-bc13-430d-825f-ddc7acef2fc8";

test("học viên viết bài, thấy cảnh báo quá ngắn, rồi nộp thành công", async ({ page }) => {
  await signInAs(page, STUDENT);
  await open(page, `/student/assignments/${ASSIGNMENT_ID}`);

  const essay = page.locator("#essay");
  await expect(essay).toBeVisible({ timeout: 20_000 });
  await shot(page, "man-hinh-viet-bai-trong");

  await essay.fill(TOO_SHORT_ESSAY);
  await expect(page.getByText(/Bài ngắn quá/)).toBeVisible({ timeout: 10_000 });
  await shot(page, "canh-bao-bai-qua-ngan");

  await essay.fill(NEW_ESSAY);
  await expect(page.getByRole("button", { name: "Nộp bài" })).toBeEnabled({ timeout: 10_000 });
  await shot(page, "man-hinh-viet-bai-da-dien-du");

  await page.getByRole("button", { name: "Nộp bài" }).click();
  await page.waitForURL(/\/student\/submissions\/[0-9a-f-]{36}/, { timeout: 30_000 });
  newSubmissionId = page.url().split("/").pop() ?? "";
  expect(newSubmissionId).toHaveLength(36);

  // This particular attempt follows an earlier "yêu cầu làm lại", so its page
  // legitimately shows that context banner instead of the plain "đang chấm"
  // placeholder (that clean state is captured separately, on a
  // never-redone fixture, in the test above).
  await expect(page.getByText(/Giáo viên đang chấm bài này|Giáo viên yêu cầu bạn làm lại bài này/)).toBeVisible({
    timeout: 15_000,
  });
});

test("giáo viên chấm điểm và duyệt bài mới nộp", async ({ page }) => {
  expect(newSubmissionId, "bước nộp bài phải chạy trước").toHaveLength(36);
  await signInAs(page, TEACHER);

  await open(page, `/teacher/submissions/${newSubmissionId}`);
  const noAiNotice = page.getByText("Chưa có bản chấm của AI");
  if (await noAiNotice.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await shot(page, "bai-nop-cho-ai-cham");
  }

  await expect(async () => {
    await open(page, `/teacher/submissions/${newSubmissionId}`);
    await expect(page.getByText("Điểm tổng")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("AI · bạn · lệch")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 150_000, intervals: [4_000] });

  await shot(page, "man-hinh-cham-bai-tong-quan");
  await shotEl(page.locator('[class*="__essayColumn"]').first(), "cot-bai-viet-va-danh-dau-ai");
  await shotEl(railBlock(page, "Điểm tổng"), "diem-tong-so-bo");
  await shotEl(railBlock(page, "Bốn tiêu chí"), "bon-tieu-chi-ai-va-giao-vien");
  await shotEl(railBlock(page, "Nhận xét"), "nhan-xet-ai-va-goi-y-sua");

  // Edit one criterion score away from the AI's figure.
  const trInput = page.getByLabel(/Điểm giáo viên cho Task Response/);
  await trInput.click();
  const current = Number(await trInput.inputValue()) || 6;
  const bumped = (current >= 1 ? current - 0.5 : current + 0.5).toFixed(1);
  await trInput.fill(bumped);
  await trInput.blur();

  await page.locator("#summary").fill(
    "Bài viết trình bày rõ hai quan điểm và có lập luận riêng, nhưng đoạn thân bài thứ hai " +
      "cần thêm ví dụ cụ thể để đạt điểm Task Response cao hơn.",
  );

  const firstSuggestion = railBlock(page, "Nhận xét").locator('input[type="checkbox"]').first();
  if (await firstSuggestion.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await firstSuggestion.check();
  }

  await page.locator("#note").fill(
    "Hạ nhẹ TR vì đoạn 2 chưa có ví dụ cụ thể — xem chi tiết trong nhận xét.",
  );
  await shotEl(railBlock(page, "Nhận xét"), "sua-diem-va-ghi-chu-noi-bo");

  await page.getByRole("button", { name: "Lưu bản sửa" }).click();

  // Give this a generous timeout: it only appears once the revision has
  // actually round-tripped to the server. Tag it for real (rather than "Để
  // sau") so untagged revisions from earlier runs of this same fixture don't
  // keep piling up and reopening this modal on every future run.
  const reasonModal = page.getByRole("heading", { name: "Vì sao bạn sửa điểm của AI?" });
  if (await reasonModal.isVisible({ timeout: 60_000 }).catch(() => false)) {
    await page.getByRole("checkbox", { name: "AI chấm quá rộng tay" }).check();
    await shotEl(wizardPanel(page), "hop-thoai-ly-do-sua-diem");
    await page.getByRole("button", { name: /^Ghi lý do cho/ }).click();
    await expect(reasonModal).toBeHidden({ timeout: 15_000 });
  }
  await page.waitForTimeout(500);
  await shotEl(railBlock(page, "Nhận xét"), "xem-truoc-ban-gui-hoc-vien");

  // Defensive: if the prompt above appeared later than expected and is still
  // open, dismiss it now so it cannot block every click for the rest of the
  // test (its overlay intercepts pointer events on everything behind it).
  const overlay = page.locator('[class*="__wizardOverlay"]').first();
  if (await overlay.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden({ timeout: 10_000 }).catch(() => {});
  }

  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
  await shotEl(wizardPanel(page), "lich-su-cham-diem");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Duyệt điểm" }).click();
  await expect(page.getByText(/Đã duyệt ·/)).toBeVisible({ timeout: 30_000 });
  await shotEl(railBlock(page, "Đã duyệt"), "da-duyet-diem-thanh-cong");
});

test("học viên xem kết quả đã duyệt", async ({ page }) => {
  expect(newSubmissionId, "các bước trước phải chạy trước").toHaveLength(36);
  await signInAs(page, STUDENT);
  await open(page, `/student/submissions/${newSubmissionId}`);
  await expect(page.getByText("Giáo viên đã duyệt")).toBeVisible({ timeout: 20_000 });
  await shot(page, "hoc-vien-xem-ket-qua-da-duyet");
});
