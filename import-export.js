(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {}),
    Core = NS.Core;

  async function exportJson() {
    const data = JSON.stringify(Core.getState(), null, 2),
      filename = "seabirds-dive-log.json",
      bytes = new TextEncoder().encode(data).byteLength;
    if (window.SeaBirdsDesktop?.saveJson) {
      const result = await window.SeaBirdsDesktop.saveJson(filename, data);
      if (!result.canceled)
        Core.notify(`Backup saved · ${(result.bytes / 1048576).toFixed(2)} MB`);
      return;
    }
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: "SeaBirds JSON backup",
                accept: { "application/json": [".json"] },
              },
            ],
          }),
          writable = await handle.createWritable();
        await writable.write(new Blob([data], { type: "application/json" }));
        await writable.close();
        Core.notify(`Backup saved · ${(bytes / 1048576).toFixed(2)} MB`);
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    const link = document.createElement("a"),
      url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function restoreJson(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.dives))
      throw new Error("This is not a valid SeaBirds logbook backup.");
    if (
      !confirm(
        `Restore ${parsed.dives.length} dives from this backup? This replaces the current logbook, equipment lists and settings on this account.`,
      )
    )
      return;
    const restored = Core.normalizeState(parsed);
    await Core.commit((state) => {
      state.dives = Core.clone(restored.dives);
      state.deletedDiveIds = Core.clone(restored.deletedDiveIds);
      state.gearLibrary = Core.clone(restored.gearLibrary);
      state.settings = Core.clone(restored.settings);
      state.revision = restored.revision || 0;
      state.updatedAt = restored.updatedAt || "";
    });
    Core.notify(`Restored ${restored.dives.length} dives from backup`);
  }

  async function importUddf(file) {
    const xml = new DOMParser().parseFromString(
      await file.text(),
      "application/xml",
    );
    if (xml.querySelector("parsererror"))
      throw new Error("The selected file is not valid UDDF XML.");
    const text = (parent, tag) =>
      [...(parent?.children || [])]
        .find((child) => child.localName === tag)
        ?.textContent?.trim() || "";
    const number = (item) => {
      const parsed = Number.parseFloat(item);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const generatedBySeaBirds =
      xml.querySelector("generator > name")?.textContent?.trim() === "SeaBirds";
    const dives = [...xml.querySelectorAll("dive")].map((node) => {
      const before = [...node.children].find(
        (child) => child.localName === "informationbeforedive",
      );
      const after = [...node.children].find(
        (child) => child.localName === "informationafterdive",
      );
      const application = [...node.children].find(
        (child) => child.localName === "applicationdata",
      );
      const seaBirds = [...(application?.children || [])].find(
        (child) => child.localName === "seabirds",
      );
      const legacySeaBirdsTime =
        generatedBySeaBirds && text(seaBirds, "profiletimeunit") !== "seconds";
      const rawProfile = [...node.querySelectorAll("samples waypoint")]
        .map((waypoint) => {
          const rawTime = number(text(waypoint, "divetime"));
          const depth = number(text(waypoint, "depth"));
          if (rawTime === null || depth === null) return null;
          const rawTemperature = number(text(waypoint, "temperature"));
          return {
            t: legacySeaBirdsTime ? rawTime : rawTime / 60,
            depth,
            ...(rawTemperature === null
              ? {}
              : {
                  temperature:
                    rawTemperature > 150
                      ? rawTemperature - 273.15
                      : rawTemperature,
                }),
            ...(number(text(waypoint, "ndl")) === null
              ? {}
              : { ndl: number(text(waypoint, "ndl")) }),
            ...(number(text(waypoint, "tts")) === null
              ? {}
              : { tts: number(text(waypoint, "tts")) }),
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.t - right.t);
      const datetime = text(before, "datetime") || text(node, "datetime");
      const rawDuration = number(
        text(after, "diveduration") ||
          text(after, "divetime") ||
          text(node, "divetime"),
      );
      const duration =
        rawDuration === null
          ? Math.max(1, Math.round(rawProfile.at(-1)?.t || 0))
          : Math.max(
              1,
              Math.round(legacySeaBirdsTime ? rawDuration : rawDuration / 60),
            );
      const rawTemperature = number(
        text(after, "lowesttemperature") || text(node, "lowesttemperature"),
      );
      const depth =
        number(
          text(after, "greatestdepth") ||
            text(after, "maxdepth") ||
            text(node, "greatestdepth") ||
            text(node, "maxdepth"),
        ) ?? Math.max(0, ...rawProfile.map((point) => point.depth));
      return {
        id: crypto.randomUUID(),
        date:
          datetime.slice(0, 10) ||
          text(before, "date") ||
          new Date().toISOString().slice(0, 10),
        time: (datetime.match(/T?(\d{2}:\d{2})/) || [])[1] || "",
        diveNumber: text(before, "divenumber"),
        site:
          text(seaBirds, "title") ||
          text(node, "divesite") ||
          text(node, "name") ||
          "Imported dive",
        location: text(seaBirds, "location"),
        buddy: text(seaBirds, "buddy"),
        depth,
        duration,
        temp:
          rawTemperature === null
            ? (rawProfile.find((point) => point.temperature != null)
                ?.temperature ?? null)
            : rawTemperature > 150
              ? rawTemperature - 273.15
              : rawTemperature,
        notes: text(after, "notes") || "Imported from UDDF",
        diveMode: text(before, "divemode") || "Air",
        diveStyle: text(seaBirds, "style"),
        gasUsed: text(seaBirds, "gas"),
        salinity: text(seaBirds, "salinity"),
        tags: text(seaBirds, "tags")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        equipment: text(seaBirds, "equipment")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        profile: rawProfile.length
          ? rawProfile
          : Core.sampleProfile(depth, duration),
        updatedAt: new Date().toISOString(),
      };
    });
    await Core.commit((state) => state.dives.push(...dives));
    Core.notify(`Imported ${dives.length} dives`);
  }

  function init() {
    if (window.__TAURI__?.core?.invoke && !window.SeaBirdsDesktop)
      window.SeaBirdsDesktop = {
        saveJson: (filename, data) =>
          window.__TAURI__.core.invoke("save_json", { filename, data }),
      };
    const choiceDialog = document.getElementById("addDiveDialog"),
      importFile = document.getElementById("importFile");
    const choiceClose = choiceDialog.querySelector(".close");
    choiceClose.textContent = "\u00d7";
    choiceClose.setAttribute("aria-label", "Close");
    document.getElementById("addDive").onclick = () => choiceDialog.showModal();
    document.getElementById("chooseManualDive").onclick = () => {
      choiceDialog.close();
      Core.feature("diveEditor").createManual();
    };
    document.getElementById("chooseImportDive").onclick = () => {
      choiceDialog.close();
      importFile.click();
    };
    document.getElementById("backupJson").onclick = () =>
      exportJson().catch((error) =>
        Core.notify(`Backup failed · ${error.message}`),
      );
    document.getElementById("restoreJson").onchange = (event) => {
      const input = event.currentTarget;
      restoreJson(input.files[0])
        .catch((error) => Core.notify(`Restore failed · ${error.message}`))
        .finally(() => {
          input.value = "";
        });
    };
    document.getElementById("importFile").onchange = (event) =>
      importUddf(event.target.files[0]).catch((error) =>
        Core.notify(`Import failed · ${error.message}`),
      );
  }

  Core.registerFeature("importExport", {
    init,
    exportJson,
    restoreJson,
    importUddf,
  });
})();
