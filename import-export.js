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
      url = URL.createObjectURL(
        new Blob([data], { type: "application/json" }),
      );
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
      ),
      nodes = [...xml.querySelectorAll("dive")],
      dives = nodes.map((node) => {
        const get = (query) => node.querySelector(query)?.textContent?.trim(),
          datetime = get("datetime") || "",
          date =
            datetime.slice(0, 10) ||
            get("date") ||
            new Date().toISOString().slice(0, 10),
          time = (datetime.match(/T?(\d{2}:\d{2})/) || [])[1] || "",
          depth = parseFloat(get("greatestdepth") || get("maxdepth") || 0),
          duration =
            Math.round(parseFloat(get("divetime") || get("duration") || 0) / 60) ||
            1;
        return {
          id: crypto.randomUUID(),
          date,
          time,
          site: get("name") || get("divesite") || "Imported dive",
          depth,
          duration,
          temp: parseFloat(get("lowesttemperature")) || null,
          notes: "Imported from UDDF",
          diveMode: "OC",
          diveStyle: "",
          profile: Core.sampleProfile(depth, duration),
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
      exportJson().catch((error) => Core.notify(`Backup failed · ${error.message}`));
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
