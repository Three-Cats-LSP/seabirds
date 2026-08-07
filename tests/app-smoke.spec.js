const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.goto("/?smoke=1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-seabirds-ready",
    "true",
  );
});
test("starts all modules and navigates", async ({ page }) => {
  await expect(page.locator('.nav[data-view="dashboard"]')).toHaveCount(0);
  await expect(page.locator("#dashboard")).toHaveCount(0);
  await expect(page.locator("#dives")).toHaveClass(/active/);
  await expect(page.locator("#dives .stats")).toBeVisible();
  await expect(page.locator("#dives .stats article")).toHaveCount(8);
  await expect(page.locator("#statComputers")).toBeVisible();
  await expect(page.locator("#statMode")).toBeVisible();
  await expect(page.locator("#statStyle")).toBeVisible();
  await expect(page.locator("#statType")).toBeVisible();
  const modules = await page.evaluate(() =>
    [
      "diveList",
      "diveEditor",
      "diveExport",
      "equipment",
      "devices",
      "settings",
      "importExport",
    ].map((name) => Boolean(window.SeaBirds.Core.feature(name))),
  );
  expect(modules).toEqual([true, true, true, true, true, true, true]);
  await page.locator('.nav[data-view="settings"]').click();
  await expect(page.locator("#settings")).toHaveClass(/active/);
  await expect(page.locator(".settings-collapse")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.getByText("Units & formats", { exact: true }).click();
  await expect(page.locator(".settings-collapse")).toHaveAttribute("open", "");
  await expect(page.locator("#masterGearLibrary")).toBeHidden();
  await page.getByRole("button", { name: "Manage lists" }).click();
  await expect(page.locator("#settingsMain")).toBeHidden();
  await expect(page.locator("#masterGearPage")).toBeVisible();
  await expect(page.locator("#masterGearPage .master-gear")).toBeVisible();
  await page.getByRole("button", { name: /Back to Settings/ }).click();
  await expect(page.locator("#settingsMain")).toBeVisible();
});

test("calculates GF99 samples with the ZHL profile engine", async ({
  page,
}) => {
  const result = await page.evaluate(() =>
    window.SeaBirdsZhlProfile.annotate([
      { t: 0, depth: 0, gas: "21/0" },
      { t: 2, depth: 20, gas: "21/0" },
      { t: 22, depth: 20, gas: "21/0" },
      { t: 25, depth: 0, gas: "21/0" },
    ]),
  );
  expect(result).toHaveLength(4);
  expect(result.every((point) => Number.isFinite(point.gf99))).toBeTruthy();
  expect(Math.max(...result.map((point) => point.gf99))).toBeGreaterThan(0);
});
test("paginates dives and filters by year and month", async ({ page }) => {
  await page.evaluate(() =>
    window.SeaBirds.Core.commit((state) => {
      state.dives = Array.from({ length: 12 }, (_, index) => ({
        id: `page-${index}`,
        site: `Pagination dive ${index + 1}`,
        date:
          index < 6
            ? `2026-08-${String(index + 1).padStart(2, "0")}`
            : `2025-07-${String(index - 5).padStart(2, "0")}`,
        time: "10:00",
        depth: 18,
        duration: 40,
        temp: 25,
        profile: [],
      }));
    }),
  );
  await page.locator('.nav[data-view="settings"]').click();
  await page.getByLabel("Dives per page").selectOption("10");
  await page.locator('.nav[data-view="dives"]').click();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(10);
  await expect(page.locator("#divePagination")).toContainText("Page 1 of 2");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(2);
  await page.locator("#yearFilter summary").click();
  await page.locator("#yearFilters").getByLabel("2025").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(6);
  await page.locator("#monthFilter summary").click();
  await page.locator("#monthFilters").getByLabel("July").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(6);
  await expect(page.locator("#monthFilter")).toHaveAttribute("open", "");
  const panelWidths = await page.evaluate(() =>
    ["yearFilter", "monthFilter"].map((id) => {
      const dropdown = document.getElementById(id);
      return {
        trigger: dropdown.getBoundingClientRect().width,
        panel: dropdown.querySelector(".dropdown-filter-options").getBoundingClientRect()
          .width,
      };
    }),
  );
  panelWidths.forEach(({ trigger, panel }) => expect(panel).toBeCloseTo(trigger, 0));
  await page.locator("#search").click();
  await expect(page.locator("#monthFilter")).not.toHaveAttribute("open", "");
});
test("shows readable placeholders for missing dive times", async ({ page }) => {
  await page.evaluate(() =>
    window.SeaBirds.Core.commit((state) => {
      state.dives = [
        {
          id: "missing-times",
          site: "Untimed dive",
          date: "2026-08-01",
          duration: 42,
          depth: 18,
          temp: 26,
        },
      ];
    }),
  );
  await expect(page.locator("#allDives .dive-row")).toContainText(
    "--:-- – --:--",
  );
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
  await page.getByLabel("Location").fill("Okinawa");
  await page.getByRole("dialog").getByLabel("Site").fill("Blue Cave");
  await page.getByRole("dialog").getByLabel("Type").selectOption("Boat");
  await page.getByLabel("DC mode").selectOption("CC/BO");
  await page.getByLabel("Dive style").selectOption("Sidemount");
  await page.getByLabel("Salinity").selectOption("Fresh");
  await page.getByRole("button", { name: "Save changes" }).click();
  const savedRow = page.locator("#allDives .dive-row").first();
  await expect(savedRow).toContainText("Saved smoke dive");
  await expect(savedRow).toContainText("CC/BO / Sidemount");
  await expect(savedRow).toContainText("2026-08-02");
  await expect(savedRow).toContainText("2:35 PM");
  await expect(savedRow.locator(".dive-number-cell")).toContainText("321");
  await expect(savedRow).toContainText("Saved smoke dive");
  await expect
    .poll(() =>
      page.evaluate(() => window.SeaBirds.Core.getState().dives[0]?.salinity),
    )
    .toBe("Fresh");
  await expect
    .poll(() =>
      page.evaluate(() => window.SeaBirds.Core.getState().dives[0]?.diveType),
    )
    .toBe("Boat");
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator('.nav[data-view="dives"]').click();
  await page.getByRole("searchbox").fill("321");
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  await page.locator(".logbook-filter-collapse summary").click();
  await expect(page.locator("#styleFilters label")).toHaveText([
    "All",
    "Single Tank",
    "Double tanks",
    "Sidemount",
    "N/A",
  ]);
  await expect(page.locator("#typeFilters label")).toHaveText([
    "All",
    "Shore/Beach",
    "Boat",
    "N/A",
  ]);
  await page.locator("#modeFilters").getByLabel("CC/BO").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await page.locator("#styleFilters").getByLabel("Sidemount").check();
  await expect(page.locator("#allDives .dive-row")).toHaveCount(1);
  await page.locator("#typeFilters").getByLabel("Boat").check();
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

test("exports every current dive-entry field", async ({ page }) => {
  await page.goto("/");
  const exported = await page.evaluate(() => {
    const dive = {
      id: "export-fixture",
      diveNumber: 501,
      site: "Okinawa Blue Cave",
      location: "Okinawa, Japan",
      diveSite: "Blue Cave",
      diveType: "Boat",
      date: "2026-08-07",
      time: "09:15",
      endTime: "10:02",
      buddy: "Marika",
      diveMode: "3 GasNx",
      diveStyle: "Double tanks",
      gasUsed: "EAN32 · EAN50 · O₂",
      salinity: "EN13319",
      tags: ["training", "wreck"],
      notes: "Export verification notes",
      depth: 31.2,
      duration: 47,
      temp: 26.4,
      equipment: ["Regulator"],
      profile: [{ t: 1, depth: 8, temperature: 26 }],
    };
    return {
      text: window.SeaBirds.DiveTextExport.build(dive),
      uddf: window.SeaBirds.DiveUddfExport.build(dive),
    };
  });
  for (const value of [
    "501",
    "Okinawa Blue Cave",
    "Okinawa, Japan",
    "Blue Cave",
    "Boat",
    "09:15",
    "10:02",
    "Marika",
    "3 GasNx",
    "Double tanks",
    "EAN32",
    "EN13319",
    "training, wreck",
    "Export verification notes",
  ])
    expect(exported.text).toContain(value);
  for (const value of [
    "<divenumber>501</divenumber>",
    "<title>Okinawa Blue Cave</title>",
    "<location>Okinawa, Japan</location>",
    "<divesite>Blue Cave</divesite>",
    "<type>Boat</type>",
    "<endtime>10:02</endtime>",
    "<divemode>3 GasNx</divemode>",
    "<style>Double tanks</style>",
    "<gas>EAN32",
    "<salinity>EN13319</salinity>",
    "<tags>training, wreck</tags>",
    "<notes>Export verification notes</notes>",
  ])
    expect(exported.uddf).toContain(value);
});
test("exports one dive as text, PDF and UDDF", async ({ page }) => {
  await page.locator('.nav[data-view="settings"]').click();
  await page.getByLabel("Load sample dives").check();
  const textExport = await page.evaluate(() =>
    window.SeaBirds.DiveTextExport.build(
      window.SeaBirds.Core.getState().dives[0],
    ),
  );
  expect(textExport).toContain("PROFILE SAMPLES");
  expect(textExport).toMatch(/min\s+\d+\.\d m\s+\S+ \u00b0C\s+NDL/);
  expect(textExport).not.toContain("\t");
  const uddfExport = await page.evaluate(() => {
    const dive = window.SeaBirds.Core.getState().dives[0];
    return { source: dive, xml: window.SeaBirds.DiveUddfExport.build(dive) };
  });
  expect(uddfExport.xml).toContain(
    "<profiletimeunit>seconds</profiletimeunit>",
  );
  await page.locator("#importFile").setInputFiles({
    name: "round-trip.uddf",
    mimeType: "application/xml",
    buffer: Buffer.from(uddfExport.xml),
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.SeaBirds.Core.getState().dives.length),
    )
    .toBe(4);
  const restoredProfile = await page.evaluate(() => {
    const state = window.SeaBirds.Core.getState();
    const normalise = (profile) =>
      profile.map((point) => [
        point.t,
        point.depth,
        point.temperature ?? point.temp ?? null,
        point.ndl ?? null,
        point.tts ?? null,
      ]);
    return {
      duration: state.dives.at(-1).duration,
      source: normalise(state.dives[0].profile),
      restored: normalise(state.dives.at(-1).profile),
    };
  });
  expect(restoredProfile.duration).toBe(uddfExport.source.duration);
  expect(restoredProfile.restored).toEqual(restoredProfile.source);
  await page.locator('.nav[data-view="dives"]').click();
  await page.locator("#allDives .dive-row").first().click();
  const formats = [
    ["Save as Text", ".txt"],
    ["Save as PDF", ".pdf"],
    ["Save as UDDF", ".uddf"],
  ];
  for (const [label, extension] of formats) {
    await page.getByRole("button", { name: "Export dive" }).click();
    await expect(page.locator("#diveExportDialog")).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: new RegExp(label) }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(extension);
  }
});
test("creates, imports, backs up, restores and deletes dives", async ({
  page,
}) => {
  await page.locator('.nav[data-view="dives"]').click();
  await page.getByRole("button", { name: "+ Add dive" }).click();
  await expect(page.locator("#addDiveDialog")).toBeVisible();
  await page.getByRole("button", { name: /Manual Input/i }).click();
  const dialog = page.locator("#profileDialog");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notes", exact: true }),
  ).toHaveClass(/active/);
  await dialog.getByLabel("Dive title").fill("Manual Reef");
  await dialog.getByRole("button", { name: "Save changes" }).click();
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
