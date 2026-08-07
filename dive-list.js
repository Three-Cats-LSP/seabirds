(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {}),
    Core = NS.Core;
  let deviceFilters = new Set(),
    modeFilters = new Set(),
    styleFilters = new Set(),
    typeFilters = new Set(),
    yearFilters = new Set(),
    monthFilters = new Set(),
    sort = "date-desc",
    page = 1;
  const source = (d) => {
    if (
      !d.computer &&
      !d.computerModel &&
      !String(d.id || "").startsWith("shearwater-")
    )
      return "Manual entry";
    const raw = String(d.computer || d.computerModel || "Shearwater")
        .replace(/^Shearwater\s+/i, "")
        .trim(),
      known = {
        perdix: "Perdix",
        "perdix ai": "Perdix AI",
        "perdix 2": "Perdix 2",
        teric: "Teric",
        "petrel 2": "Petrel 2",
        "petrel 3": "Petrel 3",
        "nerd 2": "NERD 2",
        peregrine: "Peregrine",
        tern: "Tern",
      };
    return known[raw.toLowerCase()] || raw || "Shearwater";
  };
  const mode = (d) =>
    ({ OC: "Air", CCR: "CC/BO", pSCR: "CC/BO" })[d.diveMode] ||
    d.diveMode ||
    ((d.profile || []).some((point) => point.setpoint != null)
      ? "CC/BO"
      : "Air");
  const style = (d) => d.diveStyle || "N/A";
  const diveType = (d) => d.diveType || "";
  const stamp = (d) => `${d.date || ""}T${d.time || "00:00"}`;
  const year = (d) => String(d.date || "").slice(0, 4);
  const month = (d) => String(d.date || "").slice(5, 7);
  const monthLabel = (value) => {
    const number = Number(value);
    return number
      ? new Date(2000, number - 1, 1).toLocaleDateString(undefined, {
          month: "long",
        })
      : "";
  };
  function displayTime(value) {
    if (!value) return "";
    const [hours, minutes] = value.split(":").map(Number);
    if (Core.getState().settings.timeFormat === "24")
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
  }
  function calculatedEndTime(start, duration) {
    if (!start || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return "";
    const [hours, minutes] = start.split(":").map(Number),
      total = (hours * 60 + minutes + (+duration || 0)) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  function rows(target, dives) {
    if (!target) return;
    const state = Core.getState();
    target.innerHTML = dives.length
      ? dives
          .map((d) => {
            const date = Core.formatDate(d.date),
              diveMode = mode(d),
              diveStyle = style(d),
              classification =
                diveStyle === "N/A"
                  ? diveMode
                  : `${diveMode} / ${diveStyle}`,
              startTime = displayTime(d.time),
              endTime = displayTime(
                d.endTime || calculatedEndTime(d.time, d.duration),
              );
            return `<button class="dive-row" data-id="${Core.esc(d.id)}"><span class="dive-number-cell"><small>Dive #</small><b>${d.diveNumber ?? "&mdash;"}</b></span><span class="dive-summary"><span class="dive-title-line"><b>${Core.esc(d.site)}</b></span><span class="dive-card-details"><span class="dive-card-date">${date.ymd} ${Core.esc(startTime || "--:--")} &ndash; ${Core.esc(endTime || "--:--")}</span><span class="dive-card-divider" aria-hidden="true">|</span><em>${Core.esc(classification)}</em><span>${Core.converted(+d.depth).toFixed(1)} ${state.settings.depth}</span><span>${d.duration} min</span><span class="card-temperature">${d.temp == null ? "&mdash;" : Core.temperature(+d.temp).toFixed(0) + "&deg;" + state.settings.temp.toUpperCase()}</span></span></span><span class="dive-row-arrow">&rsaquo;</span></button>`;
          })
          .join("")
      : '<div class="empty"><b>No dives found</b>Change the search or filters to show more dives.</div>';
  }
  function sources() {
    return [...new Set(Core.getState().dives.map(source))].sort((a, b) =>
      a === "Manual entry" ? 1 : b === "Manual entry" ? -1 : a.localeCompare(b),
    );
  }
  function renderGroup(id, label, attribute, available, selected) {
    const target = document.getElementById(id);
    if (!target) return selected;
    const valid = new Set(available);
    selected = new Set([...selected].filter((item) => valid.has(item)));
    target.innerHTML = `<span>${label}:</span><label><input type="checkbox" data-${attribute}="all" ${selected.size ? "" : "checked"}> All</label>${available.map((item) => `<label><input type="checkbox" data-${attribute}="${Core.esc(item)}" ${selected.has(item) ? "checked" : ""}> ${Core.esc(item)}</label>`).join("")}`;
    return selected;
  }
  function filterSummary(id, allLabel, selected) {
    const target = document.getElementById(id);
    if (target)
      target.textContent = !selected.size
        ? allLabel
        : selected.size === 1
          ? [...selected][0]
          : `${selected.size} selected`;
  }
  function renderSortFilters() {
    const target = document.getElementById("sortFilters");
    if (!target) return;
    const options = [
      ["date-desc", "Newest"],
      ["date-asc", "Oldest"],
      ["depth-desc", "Deepest"],
    ];
    target.innerHTML = `<span>Sort:</span>${options.map(([value, label]) => `<label><input type="checkbox" data-sort="${value}" ${sort === value ? "checked" : ""}> ${label}</label>`).join("")}`;
  }
  function renderFilters() {
    const dives = Core.getState().dives;
    deviceFilters = renderGroup(
      "deviceFilters",
      "Computer",
      "device-filter",
      sources(),
      deviceFilters,
    );
    yearFilters = renderGroup(
      "yearFilters",
      "",
      "year-filter",
      [...new Set(dives.map(year).filter(Boolean))].sort().reverse(),
      yearFilters,
    );
    monthFilters = renderGroup(
      "monthFilters",
      "",
      "month-filter",
      [...new Set(dives.map(month).filter(Boolean))].sort().map(monthLabel),
      monthFilters,
    );
    filterSummary("yearFilterSummary", "All", yearFilters);
    filterSummary("monthFilterSummary", "All", monthFilters);
    renderSortFilters();
    modeFilters = renderGroup(
      "modeFilters",
      "Mode",
      "mode-filter",
      [...new Set(dives.map(mode))].sort(),
      modeFilters,
    );
    styleFilters = renderGroup(
      "styleFilters",
      "Style",
      "style-filter",
      [...new Set(dives.map(style))].sort((a, b) =>
        a === "N/A"
          ? 1
          : b === "N/A"
            ? -1
            : a.localeCompare(b),
      ),
      styleFilters,
    );
    typeFilters = renderGroup(
      "typeFilters",
      "Type",
      "type-filter",
      ["Shore/Beach", "Boat"],
      typeFilters,
    );
  }
  function renderPagination(total, totalPages) {
    const target = document.getElementById("divePagination");
    if (!target) return;
    target.innerHTML =
      totalPages > 1
        ? `<button type="button" data-page="previous" ${page === 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${totalPages} · ${total} dives</span><button type="button" data-page="next" ${page === totalPages ? "disabled" : ""}>Next</button>`
        : "";
  }
  function filterRows() {
    const state = Core.getState();
    let dives = [...state.dives],
      q = (document.getElementById("search")?.value || "").toLowerCase();
    if (q)
      dives = dives.filter((d) => JSON.stringify(d).toLowerCase().includes(q));
    if (deviceFilters.size)
      dives = dives.filter((d) => deviceFilters.has(source(d)));
    if (yearFilters.size) dives = dives.filter((d) => yearFilters.has(year(d)));
    if (monthFilters.size)
      dives = dives.filter((d) => monthFilters.has(monthLabel(month(d))));
    if (modeFilters.size) dives = dives.filter((d) => modeFilters.has(mode(d)));
    if (styleFilters.size)
      dives = dives.filter((d) => styleFilters.has(style(d)));
    if (typeFilters.size)
      dives = dives.filter((d) => typeFilters.has(diveType(d)));
    dives.sort(
      sort === "date-asc"
        ? (a, b) => stamp(a).localeCompare(stamp(b))
        : sort === "depth-desc"
          ? (a, b) => b.depth - a.depth
          : (a, b) => stamp(b).localeCompare(stamp(a)),
    );
    const perPage = Math.max(1, Number(state.settings.divesPerPage) || 25),
      totalPages = Math.max(1, Math.ceil(dives.length / perPage));
    page = Math.min(page, totalPages);
    rows(
      document.getElementById("allDives"),
      dives.slice((page - 1) * perPage, page * perPage),
    );
    renderPagination(dives.length, totalPages);
  }
  function render() {
    const state = Core.getState(),
      dives = [...state.dives].sort((a, b) => stamp(b).localeCompare(stamp(a)));
    document.getElementById("diveCount").textContent = dives.length;
    document.getElementById("statDives").textContent = dives.length;
    const mins = dives.reduce((n, d) => n + (+d.duration || 0), 0);
    document.getElementById("statTime").innerHTML =
      (mins / 60).toFixed(mins >= 600 ? 0 : 1) + "<sup>h</sup>";
    const depth = Math.max(0, ...dives.map((d) => +d.depth || 0));
    document.getElementById("statDepth").textContent = dives.length
      ? Core.converted(depth).toFixed(1) + " " + state.settings.depth
      : "—";
    const longest = Math.round(
        Math.max(0, ...dives.map((d) => +d.duration || 0)),
      ),
      hours = Math.floor(longest / 60),
      remainder = longest % 60;
    document.getElementById("statLongest").textContent = dives.length
      ? hours
        ? `${hours}h ${remainder}min`
        : `${remainder}min`
      : "—";
    renderFilters();
    filterRows();
  }
  function bindFilter(id, attribute, getSet, setSet) {
    document.getElementById(id).onchange = (event) => {
      const input = event.target.closest(`[data-${attribute}]`);
      if (!input) return;
      const value =
          input.dataset[
            attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
          ],
        selected = getSet();
      if (value === "all") selected.clear();
      else input.checked ? selected.add(value) : selected.delete(value);
      setSet(selected);
      page = 1;
      renderFilters();
      filterRows();
    };
  }
  function init() {
    Core.registerRenderer(render);
    document.getElementById("search").oninput = () => {
      page = 1;
      filterRows();
    };
    document.getElementById("sortFilters").onchange = (event) => {
      const input = event.target.closest("[data-sort]");
      if (!input) return;
      sort = input.dataset.sort;
      page = 1;
      renderSortFilters();
      filterRows();
    };
    bindFilter(
      "deviceFilters",
      "device-filter",
      () => deviceFilters,
      (value) => (deviceFilters = value),
    );
    bindFilter(
      "yearFilters",
      "year-filter",
      () => yearFilters,
      (value) => (yearFilters = value),
    );
    bindFilter(
      "monthFilters",
      "month-filter",
      () => monthFilters,
      (value) => (monthFilters = value),
    );
    bindFilter(
      "modeFilters",
      "mode-filter",
      () => modeFilters,
      (value) => (modeFilters = value),
    );
    bindFilter(
      "styleFilters",
      "style-filter",
      () => styleFilters,
      (value) => (styleFilters = value),
    );
    bindFilter(
      "typeFilters",
      "type-filter",
      () => typeFilters,
      (value) => (typeFilters = value),
    );
    const dropdowns = Array.from(
      document.querySelectorAll(".filter-dropdown"),
    );
    dropdowns.forEach((dropdown) => {
      dropdown.addEventListener("toggle", () => {
        if (!dropdown.open) return;
        dropdowns.forEach((other) => {
          if (other !== dropdown) other.removeAttribute("open");
        });
      });
    });
    document.addEventListener("pointerdown", (event) => {
      const clickedDropdown = event
        .composedPath()
        .some((node) => node?.classList?.contains("filter-dropdown"));
      if (clickedDropdown) return;
      dropdowns.forEach((dropdown) => dropdown.removeAttribute("open"));
    });
    document.getElementById("divePagination").onclick = (event) => {
      const direction = event.target.closest("[data-page]")?.dataset.page;
      if (!direction) return;
      page += direction === "next" ? 1 : -1;
      filterRows();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    document.addEventListener("click", (event) => {
      const row = event.target.closest(".dive-row");
      if (row) Core.feature("diveEditor")?.open(row.dataset.id);
    });
  }
  Core.registerFeature("diveList", { init, render, filterRows, source });
})();
