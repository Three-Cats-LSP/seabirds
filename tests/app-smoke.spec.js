const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.goto("/?smoke=1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-seabirds-ready",
    "true",
  );
});
test("starts all modules and navigates", async ({ page }) => {
  const modules = await page.evaluate(() =>
    [
      "diveList",
      "diveEditor",
      "equipment",
      "devices",
      "settings",
      "importExport",
    ].map((name) => Boolean(window.SeaBirds.Core.feature(name))),
  );
  expect(modules).toEqual([true, true, true, true, true, true]);
  await page.locator('.nav[data-view="settings"]').click();
  await expect(page.locator("#settings")).toHaveClass(/active/);
  await expect(page.locator("#masterGearLibrary")).toBeHidden();
  await page.getByRole("button", { name: "Manage lists" }).click();
  await expect(page.locator("#settingsMain")).toBeHidden();
  await expect(page.locator("#masterGearPage")).toBeVisible();
  await expect(page.locator("#masterGearPage .master-gear")).toBeVisible();
  await page.getByRole("button", { name: /Back to Settings/ }).click();
  await expect(page.locator("#settingsMain")).toBeVisible();
});
test("draft edits persist, remain searchable and filter by mode and style", async ({
  page,
}) => {
  await page.locator('.nav[data-view="settings"]').click();
  await page.getByLabel("Load sample dives").check();
  await expect(page.locator("#diveCount")).toHaveText("3");
  await page.locator('.nav[data-view="dives"]').click();
  await page.locator("#allDives .dive-row").first().click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Dive title").fill("Discard me");
  await page.getByRole("dialog").getByRole("button", { name: "×" }).click();
  await expect(page.locator("#allDives .dive-row").first()).toContainText(
    "Blue Corner",
  );
  await page.locator("#allDives .dive-row").first().click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Dive #").fill("321");
  await page.getByLabel("Dive date").fill("2026-08-02");
  await page.getByLabel("Start time").fill("14:35");
  await page.getByLabel("Dive title").fill("Saved smoke dive");
  await page.getByLabel("Dive mode").selectOption("CCR");
  await page.getByLabel("Dive style").selectOption("Sidemount");
  await page.getByRole("button", { name: "Save changes" }).click();
  const savedRow = page.locator("#allDives .dive-row").first();
  await expect(savedRow).toContainText("Saved smoke dive");
  await expect(savedRow).toContainText("CCR / Sidemount");
  await expect(savedRow).toContainText("2026-08-02");
  await expect(savedRow).toContainText("2:35 PM");
  await expect(savedRow.locator(".dive-number-cell")).toContainText("321");
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('.nav[data-view="dives"]').click();
  await page.getByRole("searchbox").fill("321");
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  await page.locator("#modeFilters").getByLabel("CCR").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await page.locator("#styleFilters").getByLabel("Sidemount").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await expect(page.locator("#allDives .dive-row")).toContainText(
    "Saved smoke dive",
  );
});
test("allows a user gas mix to override automatic gas detection", async ({
  page,
}) => {
  await page.locator('.nav[data-view="settings"]').click();
  await page.getByLabel("Load sample dives").check();
  await page.locator('.nav[data-view="dives"]').click();
  await page.locator("#allDives .dive-row").first().click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Gas Used")).toHaveValue("Air");
  await page.getByLabel("Gas Used").fill("EAN32");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#profileDialog")).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      window.SeaBirds.Core.getState().dives.some(
        (dive) => dive.gasUsed === "EAN32",
      ),
    ),
  ).toBe(true);
  await page.locator("#allDives .dive-row").first().click();
  await expect(page.locator("#profileStats")).toContainText("EAN32");
});
test("creates, imports, backs up, restores and deletes dives", async ({
  page,
}) => {
  await page.locator('.nav[data-view="dives"]').click();
  await page.getByRole("button", { name: "+ Add dive" }).click();
  const dialog = page.locator("#diveDialog");
  await dialog.getByLabel("Site").fill("Manual Reef");
  await dialog.getByLabel("Maximum depth (m)").fill("12.5");
  await dialog.getByLabel("Duration (minutes)").fill("35");
  await dialog.getByRole("button", { name: "Save dive" }).click();
  await expect(page.locator("#allDives .dive-row")).toContainText(
    "Manual Reef",
  );
  await page
    .locator("#importFile")
    .setInputFiles("tests/fixtures/one-dive.uddf");
  await expect(page.locator("#allDives")).toContainText("Smoke Reef");
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  await page.locator('.nav[data-view="settings"]').click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Backup JSON" }).click();
  const backup = await download;
  expect(backup.suggestedFilename()).toBe("seabirds-dive-log.json");
  const backupPath = await backup.path();
  await page.locator('.nav[data-view="dives"]').click();
  await page
    .locator("#allDives .dive-row")
    .filter({ hasText: "Manual Reef" })
    .click();
  page.once("dialog", (prompt) => prompt.accept());
  await page.getByRole("button", { name: "Delete dive" }).click();
  await expect(page.locator("#allDives")).not.toContainText("Manual Reef");
  await page.locator('.nav[data-view="settings"]').click();
  page.once("dialog", (prompt) => prompt.accept());
  await page.locator("#restoreJson").setInputFiles(backupPath);
  await page.waitForFunction(() =>
    window.SeaBirds.Core.getState().dives.some(
      (dive) => dive.site === "Manual Reef",
    ),
  );
  await page.locator('.nav[data-view="dives"]').click();
  await expect(page.locator("#allDives")).toContainText("Manual Reef");
});
