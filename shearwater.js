(function () {
  "use strict";

  const SERVICE = "fe25c237-0ece-443c-b0aa-e02033e7029d";
  const END = 0xc0,
    ESC = 0xdb,
    ESC_END = 0xdc,
    ESC_ESC = 0xdd;
  const timeout = (ms, message) =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    );
  const withTimeout = (promise, ms, message) =>
    Promise.race([promise, timeout(ms, message)]);
  const bytes = (value) => {
    if (value instanceof DataView)
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === "string")
      return new Uint8Array(
        (value.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)),
      );
    return new Uint8Array(value || []);
  };
  const view = (value) =>
    new DataView(value.buffer, value.byteOffset, value.byteLength);

  class Stream {
    constructor(write, transport = "ble") {
      this.writeChunk = write;
      this.transport = transport;
      this.queue = [];
      this.waiters = [];
      this.packet = [];
      this.escaped = false;
    }
    push(value) {
      const data = bytes(value);
      // Shearwater V1 BLE notifications have a two-byte frame count/index prefix.
      for (
        let i = this.transport === "ble" && data.length >= 2 ? 2 : 0;
        i < data.length;
        i++
      ) {
        let c = data[i];
        if (c === END) {
          if (this.packet.length) {
            const packet = new Uint8Array(this.packet);
            this.packet = [];
            this.deliver(packet);
          }
          this.escaped = false;
          continue;
        }
        if (c === ESC) {
          this.escaped = true;
          continue;
        }
        if (this.escaped) {
          if (c === ESC_END) c = END;
          else if (c === ESC_ESC) c = ESC;
          this.escaped = false;
        }
        this.packet.push(c);
      }
    }
    deliver(packet) {
      const waiter = this.waiters.shift();
      waiter ? waiter(packet) : this.queue.push(packet);
    }
    read(ms = 5000) {
      return this.queue.length
        ? Promise.resolve(this.queue.shift())
        : Promise.race([
            new Promise((resolve) => this.waiters.push(resolve)),
            timeout(ms, "The Shearwater did not answer the protocol command."),
          ]);
    }
    async write(packet) {
      const encoded = [];
      for (const c of packet)
        c === END
          ? encoded.push(ESC, ESC_END)
          : c === ESC
            ? encoded.push(ESC, ESC_ESC)
            : encoded.push(c);
      encoded.push(END);
      if (this.transport === "serial") {
        await this.writeChunk(new Uint8Array(encoded));
        return;
      }
      const frames = Math.ceil((encoded.length + 1) / 18);
      let offset = 0;
      for (let index = 0; index < frames; index++) {
        const part = encoded.slice(offset, offset + 18);
        offset += part.length;
        await this.writeChunk(new Uint8Array([frames, index, ...part]));
      }
    }
    async transfer(payload, ms = 5000) {
      await this.write(
        new Uint8Array([0xff, 0x01, payload.length + 1, 0x00, ...payload]),
      );
      const packet = await this.read(ms);
      if (
        packet.length < 4 ||
        packet[0] !== 0x01 ||
        packet[1] !== 0xff ||
        packet[3] !== 0x00 ||
        packet[2] - 1 !== packet.length - 4
      )
        throw new Error("The Shearwater returned an invalid protocol frame.");
      return packet.slice(4);
    }
    async rdbi(id) {
      const result = await this.transfer(
        new Uint8Array([0x22, id >> 8, id & 255]),
      );
      if (
        result.length < 3 ||
        result[0] !== 0x62 ||
        result[1] !== id >> 8 ||
        result[2] !== (id & 255)
      )
        throw new Error(
          `Shearwater rejected identity query 0x${id.toString(16)}.`,
        );
      return result.slice(3);
    }
    async wdbi(id, data) {
      const result = await this.transfer(
        new Uint8Array([0x2e, id >> 8, id & 255, ...data]),
      );
      if (
        result.length < 3 ||
        result[0] !== 0x6e ||
        result[1] !== id >> 8 ||
        result[2] !== (id & 255)
      )
        throw new Error(`Shearwater rejected time write 0x${id.toString(16)}.`);
    }
    async download(address, size, compression = false) {
      const init = await this.transfer(
        new Uint8Array([
          0x35,
          compression ? 0x10 : 0x00,
          0x34,
          address >>> 24,
          address >>> 16,
          address >>> 8,
          address,
          size >>> 16,
          size >>> 8,
          size,
        ]),
      );
      if (init[0] !== 0x75)
        throw new Error("Shearwater rejected the log manifest request.");
      const output = [];
      let compressed = 0,
        done = false;
      for (
        let block = 1;
        compressed < size && !done;
        block = (block + 1) & 255
      ) {
        const response = await this.transfer(
          new Uint8Array([0x36, block]),
          8000,
        );
        if (response[0] !== 0x76 || response[1] !== block)
          throw new Error("Unexpected Shearwater manifest block.");
        const payload = response.slice(2);
        compressed += payload.length;
        if (compression) {
          if ((payload.length * 8) % 9)
            throw new Error("Invalid compressed Shearwater dive block.");
          for (
            let bitOffset = 0;
            bitOffset + 9 <= payload.length * 8;
            bitOffset += 9
          ) {
            let value = 0;
            for (let bit = 0; bit < 9; bit++)
              value =
                (value << 1) |
                ((payload[(bitOffset + bit) >> 3] >>
                  (7 - ((bitOffset + bit) & 7))) &
                  1);
            if (value & 0x100) output.push(value & 255);
            else if (value === 0) {
              done = true;
              break;
            } else for (let i = 0; i < value; i++) output.push(0);
          }
        } else output.push(...payload);
      }
      const quit = await this.transfer(new Uint8Array([0x37]));
      if (quit[0] !== 0x77)
        throw new Error(
          "Shearwater did not close the manifest transfer cleanly.",
        );
      if (compression)
        for (let i = 32; i < output.length; i++) output[i] ^= output[i - 32];
      return new Uint8Array(compression ? output : output.slice(0, size));
    }
  }

  function selectCharacteristics(characteristics) {
    const notify = characteristics.find(
      (c) => c.properties.notify || c.properties.indicate,
    );
    const write = characteristics.find(
      (c) => c.properties.writeWithoutResponse || c.properties.write,
    );
    if (!notify || !write)
      throw new Error(
        "SeaBirds could not find the Shearwater serial characteristics.",
      );
    return { notify, write };
  }

  async function nativeConnection(plugin) {
    await plugin.initialize({ androidNeverForLocation: true });
    const device = await plugin.requestDevice({ services: [SERVICE] });
    await plugin.connect({ deviceId: device.deviceId });
    const found = await plugin.getServices({ deviceId: device.deviceId });
    const service = found.services.find(
      (s) => s.uuid.toLowerCase() === SERVICE,
    );
    if (!service)
      throw new Error(
        "The connected device does not expose the Shearwater log service.",
      );
    const selected = selectCharacteristics(service.characteristics);
    const stream = new Stream(async (data) => {
      const options = {
        deviceId: device.deviceId,
        service: SERVICE,
        characteristic: selected.write.uuid,
        value: Array.from(data)
          .map((x) => x.toString(16).padStart(2, "0"))
          .join(""),
      };
      return selected.write.properties.writeWithoutResponse
        ? plugin.writeWithoutResponse(options)
        : plugin.write(options);
    });
    const eventName = `notification|${device.deviceId}|${SERVICE}|${selected.notify.uuid.toLowerCase()}`;
    await plugin.addListener(eventName, (event) => stream.push(event.value));
    await plugin.startNotifications({
      deviceId: device.deviceId,
      service: SERVICE,
      characteristic: selected.notify.uuid,
    });
    return { device, stream };
  }

  async function webConnection(progress) {
    if (!navigator.bluetooth)
      throw new Error("Bluetooth is unavailable in this browser.");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
      optionalServices: [SERVICE],
    });
    let server, service, lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        progress(
          attempt === 1
            ? "Connecting to Perdix GATT…"
            : `Perdix disconnected. Reconnecting (${attempt}/3)…`,
        );
        server = device.gatt.connected
          ? device.gatt
          : await withTimeout(
              device.gatt.connect(),
              7000,
              "Windows timed out opening the Perdix GATT connection.",
            );
        if (!server.connected)
          throw new Error("GATT connection closed immediately.");
        service = await withTimeout(
          server.getPrimaryService(SERVICE),
          5000,
          "Windows timed out discovering the Shearwater service.",
        );
        break;
      } catch (error) {
        lastError = error;
        if (device.gatt.connected) device.gatt.disconnect();
        if (attempt < 3)
          await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!service)
      throw new Error(
        `Windows could not open the Perdix BLE service after 3 attempts. Close other dive/Bluetooth apps, remove Perdix from Windows Bluetooth devices, restart its Bluetooth mode, and reconnect. ${lastError?.message || ""}`.trim(),
      );
    const selected = selectCharacteristics(await service.getCharacteristics());
    const stream = new Stream((data) =>
      selected.write.properties.writeWithoutResponse
        ? selected.write.writeValueWithoutResponse(data)
        : selected.write.writeValueWithResponse(data),
    );
    selected.notify.addEventListener("characteristicvaluechanged", (event) =>
      stream.push(event.target.value),
    );
    await selected.notify.startNotifications();
    return { device, stream };
  }

  async function serialConnection(progress) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) {
      progress("Finding paired Perdix serial ports...");
      const ports = await invoke("serial_ports");
      if (!ports.length)
        throw new Error(
          "No Windows serial ports were found. Pair the Perdix in Windows Bluetooth settings first.",
        );
      let selected = ports[0];
      if (ports.length > 1) {
        const answer = prompt(
          `Choose the paired Perdix port:\n${ports.map((port, index) => `${index + 1}. ${port.label}`).join("\n")}\n\nEnter its number:`,
          "1",
        );
        if (answer == null) throw new Error("Perdix connection canceled.");
        const index = Number.parseInt(answer, 10) - 1;
        if (!Number.isInteger(index) || !ports[index])
          throw new Error("Invalid serial port selection.");
        selected = ports[index];
      }
      progress(`Opening ${selected.label}...`);
      await invoke("serial_open", { portName: selected.portName });
      const stream = new Stream(
        (data) => invoke("serial_write", { data: Array.from(data) }),
        "serial",
      );
      let reading = true;
      (async () => {
        while (reading) {
          try {
            const data = await invoke("serial_read");
            if (data?.length) stream.push(data);
          } catch (error) {
            reading = false;
            console.warn("Perdix native serial read stopped:", error);
          }
        }
      })();
      return {
        device: { name: "Perdix" },
        stream,
        close: async () => {
          reading = false;
          await invoke("serial_close");
        },
      };
    }
    const classic = window.Capacitor?.Plugins?.BluetoothClassic;
    if (classic) {
      progress("Finding paired Perdix dive computers...");
      const permission = await classic.requestPermissions();
      if (permission?.connect && permission.connect !== "granted")
        throw new Error(
          "Allow Nearby devices so SeaBirds can connect to the Perdix.",
        );
      const result = await classic.pairedDevices();
      const devices = (result.devices || []).filter((device) =>
        /perdix|shearwater/i.test(device.name || ""),
      );
      if (!devices.length)
        throw new Error(
          "No paired Perdix was found. Open Android Settings > Bluetooth, pair the Perdix while it shows Wait PC, then return to SeaBirds.",
        );
      let selected = devices[0];
      if (devices.length > 1) {
        const answer = prompt(
          `Choose the paired Perdix:\n${devices.map((device, index) => `${index + 1}. ${device.name}`).join("\n")}\n\nEnter its number:`,
          "1",
        );
        if (answer == null) throw new Error("Perdix connection canceled.");
        const index = Number.parseInt(answer, 10) - 1;
        if (!Number.isInteger(index) || !devices[index])
          throw new Error("Invalid Perdix selection.");
        selected = devices[index];
      }
      progress(`Opening ${selected.name} with Bluetooth Classic...`);
      await classic.connect({ address: selected.address });
      const fromBase64 = (value) =>
        Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
      const toBase64 = (value) =>
        btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
      const stream = new Stream(
        (data) => classic.write({ data: toBase64(data) }),
        "serial",
      );
      let reading = true;
      (async () => {
        while (reading) {
          try {
            const result = await classic.read();
            if (result?.data) stream.push(fromBase64(result.data));
          } catch (error) {
            reading = false;
            console.warn(
              "Perdix Android Bluetooth Classic read stopped:",
              error,
            );
          }
        }
      })();
      return {
        device: { name: selected.name || "Perdix" },
        stream,
        close: async () => {
          reading = false;
          await classic.disconnect();
        },
      };
    }
    if (/Android/i.test(navigator.userAgent))
      throw new Error(
        "Android Chrome cannot access the Perdix Bluetooth Classic serial connection. Install the SeaBirds Android APK and pair the Perdix in Android Bluetooth settings.",
      );
    if (!navigator.serial)
      throw new Error(
        "Bluetooth Classic requires current Chrome or Edge on Windows.",
      );
    progress("Choose the paired Perdix serial port...");
    const port = await navigator.serial.requestPort();
    progress("Opening Perdix Bluetooth Classic...");
    await port.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    const stream = new Stream(async (data) => {
      const writer = port.writable.getWriter();
      try {
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
    }, "serial");
    (async () => {
      while (port.readable) {
        const reader = port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) stream.push(value);
          }
        } catch (error) {
          console.warn("Perdix serial read stopped:", error);
        } finally {
          reader.releaseLock();
        }
      }
    })();
    return { device: { name: "Perdix" }, stream, port };
  }

  const text = (data) =>
    new TextDecoder().decode(data).replace(/\0/g, "").trim();
  const be32 = (d, o) =>
    (d[o] * 0x1000000 + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3]) >>> 0;
  const be16 = (d, o) => (d[o] << 8) | d[o + 1];
  const be24 = (d, o) => (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
  function diveModeFromShearwater(code, gases, profile) {
    // PNF opening record 4 stores the Shearwater mode code. These values
    // match libdivecomputer's Shearwater Petrel/Predator parser.
    if (code === 0 || code === 4 || code === 5) return "CC/BO";
    if (code === 1) return "OC Tec";
    if (code === 2 || code === 3 || code === 7 || code === 12) return "Gauge";
    if (code === 6) {
      const mixes = gases.map((gas) => gas.split("/").map(Number));
      if (mixes.some(([, helium]) => helium > 0)) return "OC Tec";
      if (mixes.length > 1) return "3 GasNx";
      return mixes[0]?.[0] === 21 ? "Air" : "Nitrox";
    }
    return profile.some((point) => point.setpoint != null) ? "CC/BO" : "Air";
  }
  const salinityFromDensity = (density) =>
    density === 1000 ? "Fresh" : "Salt";
  function parseDive(raw, fallbackNumber, computerName = "Shearwater") {
    const records = [];
    for (let offset = 0; offset + 32 <= raw.length; offset += 32)
      records.push({ type: raw[offset], offset });
    const opening0 = records.find((x) => x.type === 0x10)?.offset;
    const opening3 = records.find((x) => x.type === 0x13)?.offset;
    const opening4 = records.find((x) => x.type === 0x14)?.offset;
    const opening5 = records.find((x) => x.type === 0x15)?.offset;
    const closing0 = records.find((x) => x.type === 0x20)?.offset;
    if (opening0 == null || closing0 == null)
      throw new Error("Downloaded dive has no usable opening/closing records.");
    const imperial = raw[opening0 + 8] === 1;
    const logVersion = opening4 == null ? 0 : raw[opening4 + 16];
    const intervalMs =
      logVersion >= 9 && opening5 != null ? be16(raw, opening5 + 23) : 10000;
    const profile = [];
    let timeMs = 0,
      lowestTemp = null,
      depthSum = 0,
      sampleCount = 0,
      previousDepth = 0;
    for (const record of records) {
      if (record.type !== 0x01 && record.type !== 0x03) continue;
      timeMs += intervalMs;
      let depth = be16(raw, record.offset + 1) / 10;
      if (imperial) depth *= 0.3048;
      let temperature = new Int8Array([raw[record.offset + 14]])[0];
      if (temperature < 0) {
        temperature += 102;
        if (temperature > 0) temperature = 0;
      }
      if (imperial) temperature = ((temperature - 32) * 5) / 9;
      lowestTemp =
        lowestTemp == null ? temperature : Math.min(lowestTemp, temperature);
      sampleCount++;
      depthSum += depth;
      const verticalSpeed = (depth - previousDepth) / (intervalMs / 60000);
      previousDepth = depth;
      const status = raw[record.offset + 12];
      const ccr = (status & 0x10) === 0;
      const stopDepthRaw = be16(raw, record.offset + 3);
      const stopDepth = imperial ? stopDepthRaw * 0.3048 : stopDepthRaw;
      const o2 = raw[record.offset + 8],
        he = raw[record.offset + 9];
      const pressureRaw = be16(raw, record.offset + 28);
      profile.push({
        t: timeMs / 60000,
        depth,
        temperature,
        verticalSpeed,
        meanDepth: depthSum / sampleCount,
        ndl: stopDepthRaw ? null : raw[record.offset + 10],
        stopDepth: stopDepthRaw ? stopDepth : 0,
        stopTime: stopDepthRaw ? raw[record.offset + 10] : 0,
        tts: be16(raw, record.offset + 5),
        gas: o2 || he ? `${o2}/${he}` : null,
        ppo2: ccr ? raw[record.offset + 7] / 100 : null,
        setpoint: ccr ? raw[record.offset + 19] / 100 : null,
        cns: raw[record.offset + 23],
        pressure:
          pressureRaw < 0xfff0 ? (pressureRaw & 0x0fff) * 2 * 0.0689476 : null,
        rbt: raw[record.offset + 22] < 0xf0 ? raw[record.offset + 22] : null,
      });
    }
    let maxDepth = be16(raw, closing0 + 4) / 10;
    if (imperial) maxDepth *= 0.3048;
    const durationSeconds = be24(raw, closing0 + 6);
    const started = new Date(be32(raw, opening0 + 12) * 1000);
    const gases = [...new Set(profile.map((p) => p.gas).filter(Boolean))];
    const modeCode =
      logVersion >= 8 && opening4 != null ? raw[opening4 + 1] : null;
    const density = opening3 == null ? null : be16(raw, opening3 + 3);
    const diveMode = diveModeFromShearwater(modeCode, gases, profile);
    const gasUsed = gases
      .map((gas) => {
        const [o2, helium] = gas.split("/").map(Number);
        return o2 === 21 && !helium
          ? "Air"
          : helium
            ? `Tx ${o2}/${helium}`
            : `EAN${o2}`;
      })
      .join(" · ");
    return {
      date: started.toISOString().slice(0, 10),
      time: started.toISOString().slice(11, 16),
      site: `${String(computerName).replace(/^Shearwater\s+/i, "").trim() || "Shearwater"} dive ${fallbackNumber}`,
      location: "",
      depth: maxDepth,
      avgDepth: sampleCount ? depthSum / sampleCount : 0,
      duration: Math.max(1, Math.round(durationSeconds / 60)),
      temp: lowestTemp,
      gases,
      gasUsed,
      diveMode,
      salinity: density == null ? "" : salinityFromDensity(density),
      waterDensity: density,
      gfLow: raw[opening0 + 4],
      gfHigh: raw[opening0 + 5],
      logVersion,
      notes: "",
      profile,
    };
  }
  async function connectAndInspect(progress, transport = "ble") {
    progress(
      transport === "serial"
        ? "Connecting with Bluetooth Classic..."
        : "Connecting to Bluetooth…",
    );
    const plugin = window.Capacitor?.Plugins?.BluetoothLe;
    const connection =
      transport === "serial"
        ? await serialConnection(progress)
        : plugin
          ? await nativeConnection(plugin)
          : await webConnection(progress);
    progress("Bluetooth linked. Starting Shearwater protocol…");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const serial = text(await connection.stream.rdbi(0x8010));
    const firmware = text(await connection.stream.rdbi(0x8011));
    const modelData = await connection.stream.rdbi(0x8060);
    const upload = await connection.stream.rdbi(0x8021);
    const baseAddress = be32(upload, 1);
    progress("Reading dive manifest…");
    const manifest = await connection.stream.download(0xe0000000, 0x600);
    const entries = [];
    for (let offset = 0; offset + 0x20 <= manifest.length; offset += 0x20) {
      const header = (manifest[offset] << 8) | manifest[offset + 1];
      if (header === 0xa5c4)
        entries.push({
          fingerprint: Array.from(manifest.slice(offset + 4, offset + 8))
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
          address: be32(manifest, offset + 20),
        });
      else if (header !== 0x5a23) break;
    }
    const diveManifest = entries.map((entry, index) => ({
      id: `shearwater-${serial}-${entry.fingerprint}`,
      fingerprint: entry.fingerprint,
      number: entries.length - index,
    }));
    const downloadSelected = async (fingerprints, onProgress) => {
      const wanted = new Set(fingerprints || []),
        selectedEntries = entries
          .map((entry, index) => ({ entry, index }))
          .filter((item) => wanted.has(item.entry.fingerprint));
      const dives = [];
      for (let i = 0; i < selectedEntries.length; i++) {
        const { entry, index } = selectedEntries[i];
        onProgress?.(i + 1, selectedEntries.length);
        const raw = await connection.stream.download(
          (baseAddress + entry.address) >>> 0,
          0xffffff,
          true,
        );
        dives.push({
          id: `shearwater-${serial}-${entry.fingerprint}`,
          ...parseDive(
            raw,
            entries.length - index,
            connection.device.name || "Shearwater",
          ),
          computer: connection.device.name || "Shearwater Perdix",
          computerSerial: serial,
          computerFirmware: firmware,
          updatedAt: new Date().toISOString(),
        });
      }
      return dives;
    };
    const syncTime = async () => {
      const now = new Date(),
        write32 = (value) =>
          new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]);
      if (modelData[0] === 8) {
        await connection.stream.wdbi(
          0x9031,
          write32(Math.floor(now.getTime() / 1000)),
        );
        await connection.stream.wdbi(0x9032, write32(-now.getTimezoneOffset()));
        await connection.stream.wdbi(0x9033, write32(0));
      } else {
        const localTicks = Math.floor(
          Date.UTC(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
          ) / 1000,
        );
        await connection.stream.wdbi(0x9030, write32(localTicks));
      }
    };
    return {
      name: connection.device.name || "Shearwater",
      serial,
      firmware,
      model: modelData[0],
      baseAddress,
      logs: entries.length,
      dives: diveManifest,
      downloadSelected,
      syncTime,
    };
  }

  window.SeaBirdsShearwater = { connectAndInspect };
})();
