(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {}),
    Core = NS.Core;
  let activeId = null,
    draft = null;
  const normalizeDiveMode = (value, profile = []) => {
    const legacy = { OC: "Air", CCR: "CC/BO", pSCR: "CC/BO" };
    return (
      legacy[value] ||
      value ||
      (profile.some((point) => point.setpoint != null) ? "CC/BO" : "Air")
    );
  };
  function getDraft() {
    return draft;
  }
  function displayTime(value) {
    if (!value) return "";
    const [hours, minutes] = value.split(":").map(Number);
    if (Core.getState().settings.timeFormat === "24")
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const suffix = hours >= 12 ? "PM" : "AM";
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }
  function calculatedEndTime(start, duration) {
    if (!start || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return "";
    const [hours, minutes] = start.split(":").map(Number),
      total = (hours * 60 + minutes + (+duration || 0)) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  // GF99 is a calculated display value, not data that has to be present in a
  // Shearwater log.  Calculate it before rendering so stored downloads from
  // before the GF99 overlay was added get the same graph as new downloads.
  function profileWithGf99(profile, dive) {
    const engine = window.SeaBirdsZhlProfile;
    if (!engine?.annotate || profile.length < 2) return profile;
    const fallbackGas =
      (dive.gases || []).find(Boolean) ||
      profile.find((point) => point.gas)?.gas ||
      dive.gasUsed ||
      "21/0";
    return engine.annotate(profile, { gas: fallbackGas });
  }
  function renderHeader(d) {
    const date = Core.formatDate(d.date).ymd || d.date || "—",
      number = d.diveNumber ?? "—";
    document.getElementById("profileTitle").innerHTML =
      `<span class="dive-entry-primary"><span class="dive-entry-number">#${Core.esc(number)}</span><span class="dive-entry-title">${Core.esc(d.site || "Untitled dive")}</span></span><span class="dive-entry-meta">${Core.esc(date)}</span>`;
  }
  function renderGroupChoices(d) {
    const target = document.getElementById("editDiveGroups"),
      groups = Core.getState().diveGroups || [],
      matches = Core.feature("diveList")?.matchesGroup;
    if (!target) return;
    target.innerHTML = `<legend>Groups</legend>${groups.length ? groups.map((group) => {
      const automatic = group.type === "rule";
      const checked = automatic ? matches?.(d, group) : (d.groupIds || []).includes(group.id);
      const detail = automatic ? `${group.field}: ${group.value}` : "Manual";
      return `<label><input type="checkbox" data-dive-group="${Core.esc(group.id)}" ${checked ? "checked" : ""} ${automatic ? "disabled" : ""}> ${Core.esc(group.name)} <small>${Core.esc(detail)}</small></label>`;
    }).join("") : '<small>Create dive groups in Settings to organize this logbook.</small>'}`;
  }
  function fill(d) {
    const state = Core.getState(),
      rawProfile = d.profile?.length
        ? d.profile.map((point) => ({ ...point, t: point.t ?? point.time }))
        : Core.sampleProfile(+d.depth, +d.duration),
      profile = profileWithGf99(rawProfile, d),
      temps = profile
        .map((p) => p.temperature ?? p.temp)
        .filter(Number.isFinite),
      tts = profile.map((p) => p.tts).filter(Number.isFinite),
      gases = [
        ...new Set([
          ...(d.gases || []),
          ...profile.map((p) => p.gas).filter(Boolean),
        ]),
      ].map(Core.formatGas),
      cns = profile.map((p) => p.cns).filter(Number.isFinite),
      depths = profile.map((p) => +p.depth).filter(Number.isFinite),
      average =
        d.avgDepth ||
        (depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0),
      minimumTemp = temps.length
        ? Core.temperature(Math.min(...temps)).toFixed(1) +
          "°" +
          state.settings.temp.toUpperCase()
        : d.temp != null
          ? Core.temperature(+d.temp).toFixed(1) +
            "°" +
            state.settings.temp.toUpperCase()
          : null,
      averageTemp = temps.length
        ? Core.temperature(
            temps.reduce((a, b) => a + b, 0) / temps.length,
          ).toFixed(1) +
          "°" +
          state.settings.temp.toUpperCase()
        : d.temp != null
          ? Core.temperature(+d.temp).toFixed(1) +
            "°" +
            state.settings.temp.toUpperCase()
          : null,
      detectedGas = gases.length
        ? gases.join(" · ")
        : profile.some((p) => p.setpoint != null)
          ? null
          : "Air",
      gas = d.gasUsed || detectedGas,
      mode = normalizeDiveMode(d.diveMode, profile),
      formattedDate = Core.formatDate(d.date).full,
      formattedTime = displayTime(d.time);
    document.getElementById("profileTitle").textContent =
      d.site +
      " · " +
      formattedDate +
      (formattedTime ? " · " + formattedTime : "");
    document.getElementById("telemetryNotice").hidden =
      profile.some((p) => p.ndl != null || p.tts != null || p.gas) ||
      !String(d.id).startsWith("shearwater-");
    const stats = [
      ["Dive date", formattedDate],
      ["Dive time", formattedTime || null],
      ["Dive mode", mode],
      ["Salinity", d.salinity || null],
      [
        "Maximum depth",
        Core.converted(+d.depth).toFixed(1) + " " + state.settings.depth,
      ],
      ["Duration", d.duration + " min"],
      ["Minimum water temp", minimumTemp],
      ["Average temperature", averageTemp],
      [
        "Mean Depth",
        average
          ? Core.converted(average).toFixed(1) + " " + state.settings.depth
          : null,
      ],
      ["Maximum TTS", tts.length ? Math.max(...tts) + " min" : null],
      ["Maximum CNS", cns.length ? Math.max(...cns) + "%" : null],
      ["Gas used", gas],
      ["Device GF", d.gfLow != null ? d.gfLow + "/" + d.gfHigh : null],
    ].filter((item) => item[1] != null);
    document.getElementById("profileStats").innerHTML = stats
      .map(
        ([label, value]) =>
          `<span><b>${Core.esc(value)}</b>${Core.esc(label)}</span>`,
      )
      .join("");
    document.getElementById("editDiveNumber").value = d.diveNumber ?? "";
    document.getElementById("editDiveDate").value = d.date || "";
    document.getElementById("editDiveTime").value = d.time || "";
    document.getElementById("editDiveTitle").value = d.site || "";
    document.getElementById("editDiveLocation").value =
      d.location === "Downloaded from Shearwater" ? "" : d.location || "";
    document.getElementById("editDiveSpot").value = d.diveSite || "";
    document.getElementById("editDiveBuddy").value = d.buddy || "";
    document.getElementById("editDiveType").value = d.diveType || "";
    document.getElementById("editDiveTags").value = (d.tags || []).join(", ");
    document.getElementById("editDiveMode").value = mode;
    document.getElementById("editDiveStyle").value = d.diveStyle || "";
    document.getElementById("editDiveGas").value = gas || "";
    document.getElementById("editDiveSalinity").value = d.salinity || "";
    document.getElementById("editDiveNotes").value =
      d.notes === "Downloaded from Perdix" ? "" : d.notes || "";
    renderGroupChoices(d);
    Core.feature("equipment")?.renderDive(d);
    const isComputerDive = String(d.id).startsWith("shearwater-"),
      serialFallback = isComputerDive ? String(d.id).split("-")[1] : null,
      info = [
        ["Model", d.computer || "Shearwater Perdix"],
        ["Serial", d.computerSerial || serialFallback || "—"],
        ["Firmware", d.computerFirmware || "Refresh from computer"],
        [
          "Log version",
          d.logVersion != null
            ? d.logVersion + " (PNF)"
            : "Refresh from computer",
        ],
        [
          "Decompression model",
          d.gfLow != null
            ? `Bühlmann GF ${d.gfLow}/${d.gfHigh}`
            : "Refresh from computer",
        ],
        ["Log fingerprint", String(d.id).split("-").pop()],
      ];
    document.getElementById("diveInformation").innerHTML =
      `<h3 class="info-section-title">Dive computer</h3>${info.map(([label, value]) => `<div class="info-cell"><b>${Core.esc(value)}</b>${Core.esc(label)}</div>`).join("")}`;
    document
      .querySelectorAll("[data-dive-tab]")
      .forEach((node) =>
        node.classList.toggle("active", node.dataset.diveTab === "profile"),
      );
    document
      .querySelectorAll("[data-dive-panel]")
      .forEach((node) =>
        node.classList.toggle("active", node.dataset.divePanel === "profile"),
      );
    const ceiling = profile
      .map((p) => ({ t: +(p.t ?? p.time), ceil: +(p.stopDepth || 0) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.ceil));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        drawDiveProfile("seaBirdsProfileCanvas", profile, {
          maxDepth: +d.depth,
          totalTime: +d.duration,
          isLight: true,
          ceilingWps: ceiling,
          showDecoCeiling: true,
          showGF99: true,
        }),
      ),
    );
  }
  function showEntry(entry, isNew = false) {
    activeId = entry.id;
    draft = Core.clone(entry);
    fill(draft);
    renderHeader(draft);
    const endTime =
      draft.endTime || calculatedEndTime(draft.time, draft.duration);
    draft.endTime = endTime;
    document.getElementById("editDiveEndTime").value = endTime;
    document.getElementById("deleteDive").hidden = isNew;
    document.getElementById("profileDialog").showModal();
    if (isNew) document.querySelector('[data-dive-tab="notes"]').click();
  }
  function open(id) {
    const found = Core.getState().dives.find((item) => item.id === id);
    if (found) showEntry(found);
  }
  function createManual() {
    const now = new Date(),
      local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    showEntry(
      {
        id: `manual-${crypto.randomUUID()}`,
        date: local.toISOString().slice(0, 10),
        time: local.toTimeString().slice(0, 5),
        site: "Untitled dive",
        location: "",
        buddy: "",
        diveType: "",
        tags: [],
        notes: "",
        diveMode: "Air",
        diveStyle: "",
        gasUsed: "",
        salinity: "",
        depth: 0,
        duration: 0,
        temp: null,
        profile: [],
        equipment: [],
        equipmentCards: [],
        equipmentCategories: {},
        updatedAt: now.toISOString(),
      },
      true,
    );
  }
  function close() {
    draft = null;
    activeId = null;
    document.getElementById("deleteDive").hidden = false;
  }
  async function save() {
    if (!draft) return;
    const rawDiveNumber = document
        .getElementById("editDiveNumber")
        .value.trim(),
      date = document.getElementById("editDiveDate").value,
      time = document.getElementById("editDiveTime").value;
    if (
      rawDiveNumber &&
      (!/^\d{1,4}$/.test(rawDiveNumber) ||
        +rawDiveNumber < 1 ||
        +rawDiveNumber > 9999)
    ) {
      Core.showError(
        "Dive # must be a whole number from 1 to 9999.",
        "Invalid dive number",
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Core.showError("Choose a valid dive date.", "Invalid dive date");
      return;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      Core.showError("Choose a valid dive time.", "Invalid dive time");
      return;
    }
    draft.diveNumber = rawDiveNumber ? +rawDiveNumber : null;
    draft.date = date;
    draft.time = time;
    draft.site =
      document.getElementById("editDiveTitle").value.trim() || draft.site;
    draft.location = document.getElementById("editDiveLocation").value.trim();
    draft.diveSite = document.getElementById("editDiveSpot").value.trim();
    draft.buddy = document.getElementById("editDiveBuddy").value.trim();
    draft.diveType = document.getElementById("editDiveType").value;
    draft.tags = document
      .getElementById("editDiveTags")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    draft.groupIds = [...document.querySelectorAll("#editDiveGroups [data-dive-group]:checked")]
      .filter((input) => !input.disabled)
      .map((input) => input.dataset.diveGroup);
    draft.diveMode = document.getElementById("editDiveMode").value;
    draft.diveStyle = document.getElementById("editDiveStyle").value;
    draft.gasUsed = document.getElementById("editDiveGas").value.trim();
    draft.salinity = document.getElementById("editDiveSalinity").value;
    draft.notes = document.getElementById("editDiveNotes").value.trim();
    draft.userEdited = true;
    draft.updatedAt = new Date().toISOString();
    const saved = Core.clone(draft);
    await Core.commit((state) => {
      const index = state.dives.findIndex((item) => item.id === activeId);
      if (index >= 0) state.dives[index] = saved;
      else state.dives.push(saved);
    });
    document.getElementById("profileDialog").close();
    Core.notify("Dive details saved");
  }
  async function remove() {
    const current = draft;
    if (
      !current ||
      !confirm(
        `Delete "${current.site}" from your logbook? It will stay excluded from future device downloads.`,
      )
    )
      return;
    await Core.commit((state) => {
      state.deletedDiveIds = [
        ...new Set([...(state.deletedDiveIds || []), activeId]),
      ];
      state.dives = state.dives.filter((item) => item.id !== activeId);
    });
    document.getElementById("profileDialog").close();
    Core.notify("Dive deleted");
  }
  function init() {
    document.querySelectorAll("[data-dive-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          document
            .querySelectorAll("[data-dive-tab]")
            .forEach((node) =>
              node.classList.toggle("active", node === button),
            );
          document
            .querySelectorAll("[data-dive-panel]")
            .forEach((node) =>
              node.classList.toggle(
                "active",
                node.dataset.divePanel === button.dataset.diveTab,
              ),
            );
        }),
    );
    document.getElementById("editDiveEndTime").oninput = (event) => {
      if (draft) draft.endTime = event.target.value;
    };
    document.getElementById("saveDiveDetails").onclick = save;
    document.getElementById("deleteDive").onclick = remove;
    document.getElementById("profileDialog").addEventListener("close", close);
  }
  Core.registerFeature("diveEditor", { init, open, createManual, getDraft });
})();
