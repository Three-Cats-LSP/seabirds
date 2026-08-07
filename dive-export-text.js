(function () {
  "use strict";
  const NS = (window.SeaBirds = window.SeaBirds || {});
  function value(item, fallback = "\u2014") {
    return item === null || item === undefined || item === "" ? fallback : item;
  }
  function profileLine(point) {
    const temperature = value(point.temperature ?? point.temp),
      ndl = value(point.ndl),
      tts = value(point.tts);
    return `${point.t.toFixed(1).padStart(6)} min   ${point.depth.toFixed(1).padStart(5)} m   ${String(temperature).padStart(5)} \u00b0C   NDL ${String(ndl).padStart(4)}   TTS ${String(tts).padStart(4)}`;
  }
  function build(dive) {
    const p = NS.DiveExportUtils.profile(dive),
      equipment = dive.equipment || [],
      lines = [
        "SEABIRDS DIVE LOG",
        "=================",
        `Dive #: ${value(dive.diveNumber)}`,
        `Title: ${value(dive.site)}`,
        `Date: ${value(dive.date)}`,
        `Start time: ${value(dive.time)}`,
        `End time: ${value(dive.endTime)}`,
        `Dive spot: ${value(dive.location)}`,
        `Buddy: ${value(dive.buddy)}`,
        `Mode: ${value(dive.diveMode)}`,
        `Style: ${value(dive.diveStyle)}`,
        `Gas used: ${value(dive.gasUsed)}`,
        `Salinity: ${value(dive.salinity)}`,
        `Maximum depth: ${value(dive.depth)} m`,
        `Duration: ${value(dive.duration)} min`,
        `Water temperature: ${dive.temp == null ? "\u2014" : dive.temp + " \u00b0C"}`,
        `Tags: ${(dive.tags || []).join(", ") || "\u2014"}`,
        "",
        `Notes: ${value(dive.notes)}`,
        "",
        "EQUIPMENT",
        "---------",
        ...(equipment.length ? equipment : ["\u2014"]),
        "",
        "DIVE COMPUTER",
        "-------------",
        `Model: ${value(dive.computer)}`,
        `Serial: ${value(dive.computerSerial)}`,
        `Firmware: ${value(dive.computerFirmware)}`,
        `Gradient factors: ${dive.gfLow == null ? "\u2014" : dive.gfLow + "/" + dive.gfHigh}`,
      ];
    if (p.length) {
      const step = Math.max(1, Math.ceil(p.length / 80));
      lines.push(
        "",
        "PROFILE SAMPLES",
        "---------------",
        ...p.filter((_, index) => index % step === 0).map(profileLine),
      );
    }
    return lines.join("\r\n") + "\r\n";
  }
  async function save(dive) {
    const text = build(dive);
    await NS.DiveExportUtils.saveBlob(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
      NS.DiveExportUtils.safeName(dive, "txt"),
    );
  }
  NS.DiveTextExport = { build, save };
})();
