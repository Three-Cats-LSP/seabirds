(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {}), Core = NS.Core;
  const settingFields = [["depthUnit", "depth"], ["tempUnit", "temp"], ["volumeUnit", "volume"], ["weightUnit", "weight"], ["pressureUnit", "pressure"], ["dateFormat", "dateFormat"], ["timeFormat", "timeFormat"], ["divesPerPage", "divesPerPage"]];
  const GROUP_FIELDS = ["location", "diveSite", "diveStyle", "diveMode", "diveType"];
  let activeGroupId = null;

  function renderGroups() {
    const target = document.getElementById("diveGroupsLibrary");
    if (!target) return;
    const groups = Core.getState().diveGroups || [];
    target.innerHTML = groups.length
      ? groups.map((group) => `<article class="dive-group-card"><span><b>${Core.esc(group.name)}</b><small>${group.type === "rule" ? `Automatic: ${Core.esc(group.field)} = ${Core.esc(group.value)}` : "Manual collection"}</small></span><span class="dive-group-card-actions"><button type="button" class="edit-dive-group" data-group-id="${Core.esc(group.id)}">Edit</button><button type="button" class="remove-dive-group" data-group-id="${Core.esc(group.id)}" title="Delete group">×</button></span></article>`).join("")
      : "<small>No groups yet. Create a group to organize your logbook.</small>";
    target.querySelectorAll(".edit-dive-group").forEach((button) => {
      button.textContent = "✎";
      button.title = "Edit group";
      button.setAttribute("aria-label", "Edit group");
    });
    target.querySelectorAll(".remove-dive-group").forEach((button) => {
      button.title = "Delete group";
      button.setAttribute("aria-label", "Delete group");
    });
  }
  function render() {
    const state = Core.getState();
    settingFields.forEach(([id, key]) => { const node = document.getElementById(id); if (node) node.value = state.settings[key]; });
    renderGroups();
    Core.feature("equipment")?.renderMaster();
  }
  function showPage(page = "main") {
    const main = document.getElementById("settingsMain"), gear = document.getElementById("masterGearPage"), groups = document.getElementById("diveGroupsPage"), viewName = document.getElementById("viewName");
    main.hidden = page !== "main"; gear.hidden = page !== "gear"; groups.hidden = page !== "groups";
    if (viewName) viewName.textContent = page === "gear" ? "Equipment lists" : page === "groups" ? "Dive groups" : "Settings";
    if (page === "gear") Core.feature("equipment")?.renderMaster();
    if (page === "groups") renderGroups();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showMasterGear(show) { showPage(show ? "gear" : "main"); }
  function selectedGroup() { return (Core.getState().diveGroups || []).find((group) => group.id === activeGroupId); }
  function syncGroupType() {
    const rule = document.getElementById("diveGroupType").value === "rule";
    document.getElementById("diveGroupRuleFields").hidden = !rule;
    document.getElementById("diveGroupHelp").textContent = rule
      ? "Automatic groups include every dive whose selected field exactly matches the value."
      : "Manual groups are assigned from the Groups section inside each dive entry.";
  }
  function fillGroupEditor(group = selectedGroup()) {
    activeGroupId = group?.id || null;
    document.getElementById("diveGroupEditorTitle").textContent = group ? "Edit dive group" : "New dive group";
    document.getElementById("diveGroupName").value = group?.name || "";
    document.getElementById("diveGroupType").value = group?.type || "rule";
    document.getElementById("diveGroupField").value = GROUP_FIELDS.includes(group?.field) ? group.field : "location";
    document.getElementById("diveGroupValue").value = group?.value || "";
    document.getElementById("deleteDiveGroup").hidden = !group;
    syncGroupType();
  }
  function openGroupEditor(group = null) {
    fillGroupEditor(group);
    const dialog = document.getElementById("diveGroupDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }
  async function saveGroup() {
    const name = document.getElementById("diveGroupName").value.trim();
    const type = document.getElementById("diveGroupType").value;
    const field = document.getElementById("diveGroupField").value;
    const value = document.getElementById("diveGroupValue").value.trim();
    if (!name) return Core.showError("Enter a name for the dive group.", "Group name required");
    if (type === "rule" && !value) return Core.showError("Enter the value this automatic group should match.", "Match value required");
    const group = { id: activeGroupId || `group-${crypto.randomUUID()}`, name, type, ...(type === "rule" ? { field, value } : {}) };
    await Core.commit((state) => {
      const index = (state.diveGroups || []).findIndex((item) => item.id === group.id);
      if (index >= 0) state.diveGroups[index] = group;
      else state.diveGroups = [...(state.diveGroups || []), group];
    });
    activeGroupId = group.id;
    renderGroups();
    document.getElementById("diveGroupDialog")?.close();
    Core.notify(`Group "${name}" saved`);
  }
  async function deleteGroup(id = activeGroupId) {
    const group = (Core.getState().diveGroups || []).find((item) => item.id === id);
    if (!group || !confirm(`Delete group "${group.name}"? Dives will not be deleted.`)) return;
    await Core.commit((state) => {
      state.diveGroups = (state.diveGroups || []).filter((item) => item.id !== id);
      state.dives.forEach((dive) => { dive.groupIds = (dive.groupIds || []).filter((groupId) => groupId !== id); });
    });
    activeGroupId = null;
    renderGroups();
    document.getElementById("diveGroupDialog")?.close();
    Core.notify("Group deleted");
  }
  function bindMaster() {
    document.querySelector(".master-gear").onclick = async (event) => {
      const addCard = event.target.closest("#addMasterGearCard"), addItem = event.target.closest(".add-master-item"), renameCard = event.target.closest(".rename-master-card"), removeCard = event.target.closest(".remove-master-card"), renameItem = event.target.closest(".rename-master-item"), removeItem = event.target.closest(".remove-master-item");
      if (!addCard && !addItem && !renameCard && !removeCard && !renameItem && !removeItem) return;
      await Core.commit((state) => {
        const library = state.gearLibrary = state.gearLibrary || Core.defaultGearLibrary();
        if (addCard) { const name = prompt("New equipment list name (for example: Photo dive)")?.trim(); if (name) library[name] = library[name] || []; }
        else if (addItem) { const name = prompt(`Add equipment to ${addItem.dataset.category}`)?.trim(); if (name) library[addItem.dataset.category] = [...new Set([...(library[addItem.dataset.category] || []), name])]; }
        else if (renameCard) { const original = renameCard.dataset.category, name = prompt("Rename master equipment list", original)?.trim(); if (name && name !== original) { library[name] = library[original]; delete library[original]; } }
        else if (removeCard && confirm(`Delete the master list "${removeCard.dataset.category}"? Existing dives will not be changed.`)) delete library[removeCard.dataset.category];
        else if (renameItem) { const category = renameItem.dataset.category, original = renameItem.dataset.item, name = prompt("Rename master equipment item", original)?.trim(); if (name) library[category] = library[category].map((item) => item === original ? name : item); }
        else if (removeItem && confirm(`Delete "${removeItem.dataset.item}" from the ${removeItem.dataset.category} master list?`)) library[removeItem.dataset.category] = (library[removeItem.dataset.category] || []).filter((item) => item !== removeItem.dataset.item);
      }, { sync: false });
      Core.notify("Master list changed · Save to sync");
    };
    document.getElementById("saveMasterGear").onclick = () => Core.commit(() => {}).then(() => Core.notify("Master equipment lists saved"));
  }
  function init() {
    Core.registerRenderer(render);
    settingFields.forEach(([id, key]) => document.getElementById(id).onchange = (event) => Core.commit((state) => { state.settings[key] = event.target.value; if (key === "depth") window.units = event.target.value === "ft" ? "imperial" : "metric"; }));
    document.getElementById("demoToggle").onchange = (event) => Core.commit((state) => { state.dives = event.target.checked ? [...Core.demo, ...state.dives.filter((d) => !d.id.startsWith("demo-"))] : state.dives.filter((d) => !d.id.startsWith("demo-")); });
    document.getElementById("clearData").onclick = () => { if (confirm("Delete all locally stored SeaBirds dives and reset device exclusions?")) Core.commit((state) => { state.dives = []; state.deletedDiveIds = []; }).then(() => Core.notify("Local log cleared")); };
    document.getElementById("googleSignIn").onclick = () => window.SeaBirdsSync?.signIn().catch((error) => Core.notify(error?.message || String(error) || "Google sign-in failed"));
    document.getElementById("openMasterGear").onclick = () => showPage("gear");
    document.getElementById("closeMasterGear").onclick = () => showPage();
    document.getElementById("openDiveGroups").onclick = () => showPage("groups");
    document.getElementById("closeDiveGroups").onclick = () => showPage();
    document.querySelector('.nav[data-view="settings"]').addEventListener("click", () => showPage());
    document.getElementById("newDiveGroup").onclick = () => openGroupEditor();
    document.getElementById("diveGroupType").onchange = syncGroupType;
    document.getElementById("saveDiveGroup").onclick = saveGroup;
    document.getElementById("deleteDiveGroup").onclick = () => deleteGroup();
    document.getElementById("diveGroupsLibrary").onclick = (event) => {
      const edit = event.target.closest(".edit-dive-group"), remove = event.target.closest(".remove-dive-group");
      if (edit) return openGroupEditor((Core.getState().diveGroups || []).find((group) => group.id === edit.dataset.groupId));
      if (remove) deleteGroup(remove.dataset.groupId);
    };
    bindMaster();
  }
  Core.registerFeature("settings", { init, render, showMasterGear, showPage, openGroupEditor });
})();
