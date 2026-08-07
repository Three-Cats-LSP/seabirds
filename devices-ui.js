(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {}),
    Core = NS.Core;
  let computer = null;
  const button = () => document.getElementById("downloadDeviceDives"),
    dialog = () => document.getElementById("downloadDivesDialog"),
    choices = () => document.getElementById("deviceDiveChoices");
  function status(dive) {
    const state = Core.getState();
    if ((state.deletedDiveIds || []).includes(dive.id)) return "excluded";
    if (state.dives.some((item) => item.id === dive.id)) return "existing";
    return "new";
  }
  function selected() {
    return [...choices().querySelectorAll("input:checked")].map(
      (input) => input.value,
    );
  }
  function updateSelection() {
    const count = selected().length,
      node = document.getElementById("confirmDiveDownload");
    node.disabled = !count;
    node.textContent = count
      ? `Download ${count} selected ${count === 1 ? "dive" : "dives"}`
      : "Select dives to download";
  }
  function choose() {
    if (!computer) return;
    const counts = { new: 0, existing: 0, excluded: 0 };
    choices().innerHTML = computer.dives
      .map((dive) => {
        const kind = status(dive);
        counts[kind]++;
        return `<label class="device-dive-choice ${kind}"><input type="checkbox" value="${Core.esc(dive.fingerprint)}" ${kind === "new" ? "checked" : ""}><span><b>${Core.esc(computer.name)} dive ${dive.number}</b><small>Log fingerprint ${Core.esc(dive.fingerprint)}</small></span><em>${kind === "new" ? "New" : kind === "existing" ? "Already in log" : "Previously deleted"}</em></label>`;
      })
      .join("");
    document.getElementById("downloadDivesSummary").textContent =
      `${counts.new} new · ${counts.existing} already imported · ${counts.excluded} previously deleted`;
    updateSelection();
    dialog().showModal();
  }
  async function connect(trigger) {
    const box = document.getElementById("deviceStatus"),
      label = box.querySelector("b"),
      detail = box.querySelector("p");
    try {
      trigger.disabled = true;
      button().hidden = true;
      document.getElementById("syncTimeOption").hidden = true;
      const selectedModel =
          document.getElementById("deviceModel")?.value || "ble",
        transport = selectedModel === "perdix" ? "serial" : "ble";
      label.textContent =
        transport === "serial"
          ? "Connecting to Perdix with Bluetooth Classic…"
          : "Connecting with Bluetooth Low Energy…";
      computer = await window.SeaBirdsShearwater.connectAndInspect(
        (message) => {
          label.textContent = message;
          detail.textContent = "Keep the dive computer on the Wait PC screen.";
        },
        transport,
      );
      box.classList.add("connected");
      const count = computer.dives.filter(
        (dive) => status(dive) === "new",
      ).length;
      label.textContent = `${computer.name} · ${computer.logs} dive logs found`;
      detail.textContent = `${count} new · ${computer.logs - count} already imported or excluded. Choose only the dives you want.`;
      button().textContent = `Choose dives (${count} new)`;
      button().hidden = !computer.logs;
      document.getElementById("syncTimeOption").hidden = false;
      Core.notify(`Found ${count} new of ${computer.logs} dives`);
    } catch (error) {
      computer = null;
      button().hidden = true;
      document.getElementById("syncTimeOption").hidden = true;
      box.classList.remove("connected");
      label.textContent = "Shearwater connection failed";
      detail.textContent = error.message || String(error);
      Core.showError(
        error.message || String(error),
        "Shearwater connection failed",
      );
    } finally {
      trigger.disabled = false;
    }
  }
  async function download() {
    if (!computer) return;
    const fingerprints = selected();
    if (!fingerprints.length) return;
    const box = document.getElementById("deviceStatus"),
      label = box.querySelector("b"),
      detail = box.querySelector("p");
    dialog().close();
    try {
      button().disabled = true;
      if (document.getElementById("syncDeviceTime").checked) {
        label.textContent = "Synchronizing dive computer time…";
        await computer.syncTime();
      }
      const dives = await computer.downloadSelected(
        fingerprints,
        (current, total) => {
          label.textContent = `Downloading selected dive ${current} of ${total}…`;
          detail.textContent =
            "Keep the dive computer connected until the transfer finishes.";
        },
      );
      let added = 0,
        updated = 0,
        restored = 0;
      await Core.commit((state) => {
        for (const dive of dives) {
          if ((state.deletedDiveIds || []).includes(dive.id)) {
            state.deletedDiveIds = state.deletedDiveIds.filter(
              (id) => id !== dive.id,
            );
            restored++;
          }
          const index = state.dives.findIndex((item) => item.id === dive.id);
          if (index >= 0) {
            const old = state.dives[index],
              user = old.userEdited
                ? {
                    diveNumber: old.diveNumber,
                    date: old.date,
                    time: old.time,
                    endTime: old.endTime,
                    site: old.site,
                    location: old.location,
                    diveSite: old.diveSite,
                    buddy: old.buddy,
                    diveType: old.diveType,
                    tags: old.tags,
                    notes: old.notes,
                    diveMode: old.diveMode,
                    diveStyle: old.diveStyle,
                    gasUsed: old.gasUsed,
                    salinity: old.salinity,
                    equipment: old.equipment,
                    equipmentCategories: old.equipmentCategories,
                    equipmentCards: old.equipmentCards,
                    userEdited: true,
                  }
                : {};
            state.dives[index] = { ...dive, ...user };
            updated++;
          } else {
            state.dives.push(dive);
            added++;
          }
        }
      });
      label.textContent = "Selected dives downloaded";
      detail.textContent = `${added} added · ${updated} refreshed${restored ? ` · ${restored} restored` : ""}.`;
      button().textContent = "Choose dives";
      Core.navigate("dives");
      Core.notify(
        `Downloaded ${dives.length} selected ${dives.length === 1 ? "dive" : "dives"}`,
      );
    } catch (error) {
      label.textContent = "Dive download failed";
      detail.textContent = error.message || String(error);
      Core.showError(error.message || String(error), "Dive download failed");
    } finally {
      button().disabled = false;
    }
  }
  function init() {
    choices().onchange = updateSelection;
    document.getElementById("selectNewDives").onclick = () => {
      choices()
        .querySelectorAll(".device-dive-choice input")
        .forEach(
          (input) =>
            (input.checked = input.closest("label").classList.contains("new")),
        );
      updateSelection();
    };
    document.getElementById("selectAllDives").onclick = () => {
      choices()
        .querySelectorAll("input")
        .forEach((input) => (input.checked = true));
      updateSelection();
    };
    document.getElementById("selectNoDives").onclick = () => {
      choices()
        .querySelectorAll("input")
        .forEach((input) => (input.checked = false));
      updateSelection();
    };
    document.getElementById("cancelDiveDownload").onclick = () =>
      dialog().close();
    document
      .querySelectorAll(".connect")
      .forEach((node) => node.addEventListener("click", () => connect(node)));
    button().onclick = choose;
    document.getElementById("confirmDiveDownload").onclick = download;
  }
  Core.registerFeature("devices", { init });
})();
