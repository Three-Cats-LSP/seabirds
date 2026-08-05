(function () {
  'use strict';

  const SERVICE = 'fe25c237-0ece-443c-b0aa-e02033e7029d';
  const END = 0xc0, ESC = 0xdb, ESC_END = 0xdc, ESC_ESC = 0xdd;
  const timeout = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  const withTimeout = (promise, ms, message) => Promise.race([promise, timeout(ms, message)]);
  const bytes = value => {
    if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === 'string') return new Uint8Array((value.match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
    return new Uint8Array(value || []);
  };
  const view = value => new DataView(value.buffer, value.byteOffset, value.byteLength);

  class Stream {
    constructor(write, transport = 'ble') { this.writeChunk = write; this.transport = transport; this.queue = []; this.waiters = []; this.packet = []; this.escaped = false; }
    push(value) {
      const data = bytes(value);
      // Shearwater V1 BLE notifications have a two-byte frame count/index prefix.
      for (let i = this.transport === 'ble' && data.length >= 2 ? 2 : 0; i < data.length; i++) {
        let c = data[i];
        if (c === END) {
          if (this.packet.length) { const packet = new Uint8Array(this.packet); this.packet = []; this.deliver(packet); }
          this.escaped = false; continue;
        }
        if (c === ESC) { this.escaped = true; continue; }
        if (this.escaped) { if (c === ESC_END) c = END; else if (c === ESC_ESC) c = ESC; this.escaped = false; }
        this.packet.push(c);
      }
    }
    deliver(packet) { const waiter = this.waiters.shift(); waiter ? waiter(packet) : this.queue.push(packet); }
    read(ms = 5000) { return this.queue.length ? Promise.resolve(this.queue.shift()) : Promise.race([new Promise(resolve => this.waiters.push(resolve)), timeout(ms, 'The Shearwater did not answer the protocol command.')]); }
    async write(packet) {
      const encoded = [];
      for (const c of packet) c === END ? encoded.push(ESC, ESC_END) : c === ESC ? encoded.push(ESC, ESC_ESC) : encoded.push(c);
      encoded.push(END);
      if (this.transport === 'serial') {
        await this.writeChunk(new Uint8Array(encoded));
        return;
      }
      const frames = Math.ceil((encoded.length + 1) / 18);
      let offset = 0;
      for (let index = 0; index < frames; index++) {
        const part = encoded.slice(offset, offset + 18); offset += part.length;
        await this.writeChunk(new Uint8Array([frames, index, ...part]));
      }
    }
    async transfer(payload, ms = 5000) {
      await this.write(new Uint8Array([0xff, 0x01, payload.length + 1, 0x00, ...payload]));
      const packet = await this.read(ms);
      if (packet.length < 4 || packet[0] !== 0x01 || packet[1] !== 0xff || packet[3] !== 0x00 || packet[2] - 1 !== packet.length - 4)
        throw new Error('The Shearwater returned an invalid protocol frame.');
      return packet.slice(4);
    }
    async rdbi(id) {
      const result = await this.transfer(new Uint8Array([0x22, id >> 8, id & 255]));
      if (result.length < 3 || result[0] !== 0x62 || result[1] !== (id >> 8) || result[2] !== (id & 255)) throw new Error(`Shearwater rejected identity query 0x${id.toString(16)}.`);
      return result.slice(3);
    }
    async download(address, size, compression = false) {
      const init = await this.transfer(new Uint8Array([0x35, compression ? 0x10 : 0x00, 0x34, address >>> 24, address >>> 16, address >>> 8, address, size >>> 16, size >>> 8, size]));
      if (init[0] !== 0x75) throw new Error('Shearwater rejected the log manifest request.');
      const output = [];
      let compressed = 0, done = false;
      for (let block = 1; compressed < size && !done; block = (block + 1) & 255) {
        const response = await this.transfer(new Uint8Array([0x36, block]), 8000);
        if (response[0] !== 0x76 || response[1] !== block) throw new Error('Unexpected Shearwater manifest block.');
        const payload = response.slice(2);
        compressed += payload.length;
        if (compression) {
          if ((payload.length * 8) % 9) throw new Error('Invalid compressed Shearwater dive block.');
          for (let bitOffset = 0; bitOffset + 9 <= payload.length * 8; bitOffset += 9) {
            let value = 0;
            for (let bit = 0; bit < 9; bit++) value = (value << 1) | ((payload[(bitOffset + bit) >> 3] >> (7 - ((bitOffset + bit) & 7))) & 1);
            if (value & 0x100) output.push(value & 255);
            else if (value === 0) { done = true; break; }
            else for (let i = 0; i < value; i++) output.push(0);
          }
        } else output.push(...payload);
      }
      const quit = await this.transfer(new Uint8Array([0x37]));
      if (quit[0] !== 0x77) throw new Error('Shearwater did not close the manifest transfer cleanly.');
      if (compression) for (let i = 32; i < output.length; i++) output[i] ^= output[i - 32];
      return new Uint8Array(compression ? output : output.slice(0, size));
    }
  }

  function selectCharacteristics(characteristics) {
    const notify = characteristics.find(c => c.properties.notify || c.properties.indicate);
    const write = characteristics.find(c => c.properties.writeWithoutResponse || c.properties.write);
    if (!notify || !write) throw new Error('SeaBirds could not find the Shearwater serial characteristics.');
    return { notify, write };
  }

  async function nativeConnection(plugin) {
    await plugin.initialize();
    const device = await plugin.requestDevice({ services: [SERVICE] });
    await plugin.connect({ deviceId: device.deviceId });
    const found = await plugin.getServices({ deviceId: device.deviceId });
    const service = found.services.find(s => s.uuid.toLowerCase() === SERVICE);
    if (!service) throw new Error('The connected device does not expose the Shearwater log service.');
    const selected = selectCharacteristics(service.characteristics);
    const stream = new Stream(async data => {
      const options = { deviceId: device.deviceId, service: SERVICE, characteristic: selected.write.uuid, value: Array.from(data).map(x => x.toString(16).padStart(2, '0')).join('') };
      return selected.write.properties.writeWithoutResponse ? plugin.writeWithoutResponse(options) : plugin.write(options);
    });
    const eventName = `notification|${device.deviceId}|${SERVICE}|${selected.notify.uuid.toLowerCase()}`;
    await plugin.addListener(eventName, event => stream.push(event.value));
    await plugin.startNotifications({ deviceId: device.deviceId, service: SERVICE, characteristic: selected.notify.uuid });
    return { device, stream };
  }

  async function webConnection(progress) {
    if (!navigator.bluetooth) throw new Error('Bluetooth is unavailable in this browser.');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }], optionalServices: [SERVICE] });
    let server, service, lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        progress(attempt === 1 ? 'Connecting to Perdix GATT…' : `Perdix disconnected. Reconnecting (${attempt}/3)…`);
        server = device.gatt.connected ? device.gatt : await withTimeout(device.gatt.connect(), 7000, 'Windows timed out opening the Perdix GATT connection.');
        if (!server.connected) throw new Error('GATT connection closed immediately.');
        service = await withTimeout(server.getPrimaryService(SERVICE), 5000, 'Windows timed out discovering the Shearwater service.');
        break;
      } catch (error) {
        lastError = error;
        if (device.gatt.connected) device.gatt.disconnect();
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!service) throw new Error(`Windows could not open the Perdix BLE service after 3 attempts. Close other dive/Bluetooth apps, remove Perdix from Windows Bluetooth devices, restart its Bluetooth mode, and reconnect. ${lastError?.message || ''}`.trim());
    const selected = selectCharacteristics(await service.getCharacteristics());
    const stream = new Stream(data => selected.write.properties.writeWithoutResponse ? selected.write.writeValueWithoutResponse(data) : selected.write.writeValueWithResponse(data));
    selected.notify.addEventListener('characteristicvaluechanged', event => stream.push(event.target.value));
    await selected.notify.startNotifications();
    return { device, stream };
  }

  async function serialConnection(progress) {
    if (!navigator.serial) throw new Error('Bluetooth Classic requires current Chrome or Edge on Windows.');
    progress('Choose the paired Perdix serial port...');
    const port = await navigator.serial.requestPort();
    progress('Opening Perdix Bluetooth Classic...');
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    const stream = new Stream(async data => {
      const writer = port.writable.getWriter();
      try { await writer.write(data); } finally { writer.releaseLock(); }
    }, 'serial');
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
          console.warn('Perdix serial read stopped:', error);
        } finally {
          reader.releaseLock();
        }
      }
    })();
    return { device: { name: 'Perdix' }, stream, port };
  }

  const text = data => new TextDecoder().decode(data).replace(/\0/g, '').trim();
  const be32 = (d, o) => ((d[o] * 0x1000000) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3]) >>> 0;
  const be16 = (d, o) => (d[o] << 8) | d[o + 1];
  const be24 = (d, o) => (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
  function parseDive(raw, fallbackNumber) {
    const records = [];
    for (let offset = 0; offset + 32 <= raw.length; offset += 32) records.push({ type: raw[offset], offset });
    const opening0 = records.find(x => x.type === 0x10)?.offset;
    const opening4 = records.find(x => x.type === 0x14)?.offset;
    const opening5 = records.find(x => x.type === 0x15)?.offset;
    const closing0 = records.find(x => x.type === 0x20)?.offset;
    if (opening0 == null || closing0 == null) throw new Error('Downloaded dive has no usable opening/closing records.');
    const imperial = raw[opening0 + 8] === 1;
    const logVersion = opening4 == null ? 0 : raw[opening4 + 16];
    const intervalMs = logVersion >= 9 && opening5 != null ? be16(raw, opening5 + 23) : 10000;
    const profile = [];
    let timeMs = 0, lowestTemp = null, depthSum = 0, sampleCount = 0, previousDepth = 0;
    for (const record of records) {
      if (record.type !== 0x01 && record.type !== 0x03) continue;
      timeMs += intervalMs;
      let depth = be16(raw, record.offset + 1) / 10;
      if (imperial) depth *= 0.3048;
      let temperature = new Int8Array([raw[record.offset + 14]])[0];
      if (temperature < 0) { temperature += 102; if (temperature > 0) temperature = 0; }
      if (imperial) temperature = (temperature - 32) * 5 / 9;
      lowestTemp = lowestTemp == null ? temperature : Math.min(lowestTemp, temperature);
      sampleCount++;
      depthSum += depth;
      const verticalSpeed = (depth - previousDepth) / (intervalMs / 60000);
      previousDepth = depth;
      const status = raw[record.offset + 12];
      const ccr = (status & 0x10) === 0;
      const stopDepthRaw = be16(raw, record.offset + 3);
      const stopDepth = imperial ? stopDepthRaw * 0.3048 : stopDepthRaw;
      const o2 = raw[record.offset + 8], he = raw[record.offset + 9];
      const pressureRaw = be16(raw, record.offset + 28);
      profile.push({
        t: timeMs / 60000, depth, temperature, verticalSpeed, meanDepth: depthSum / sampleCount,
        ndl: stopDepthRaw ? null : raw[record.offset + 10],
        stopDepth: stopDepthRaw ? stopDepth : 0,
        stopTime: stopDepthRaw ? raw[record.offset + 10] : 0,
        tts: be16(raw, record.offset + 5),
        gas: o2 || he ? `${o2}/${he}` : null,
        ppo2: ccr ? raw[record.offset + 7] / 100 : null,
        setpoint: ccr ? raw[record.offset + 19] / 100 : null,
        cns: raw[record.offset + 23],
        pressure: pressureRaw < 0xfff0 ? (pressureRaw & 0x0fff) * 2 * 0.0689476 : null,
        rbt: raw[record.offset + 22] < 0xf0 ? raw[record.offset + 22] : null
      });
    }
    let maxDepth = be16(raw, closing0 + 4) / 10;
    if (imperial) maxDepth *= 0.3048;
    const durationSeconds = be24(raw, closing0 + 6);
    const started = new Date(be32(raw, opening0 + 12) * 1000);
    return { date: started.toISOString().slice(0, 10), site: `Perdix dive ${fallbackNumber}`, location: 'Downloaded from Shearwater', depth: maxDepth, avgDepth: sampleCount ? depthSum / sampleCount : 0, duration: Math.max(1, Math.round(durationSeconds / 60)), temp: lowestTemp, gfLow: raw[opening0 + 4], gfHigh: raw[opening0 + 5], notes: 'Downloaded from Perdix', profile };
  }
  async function connectAndInspect(progress, transport = 'ble') {
    progress(transport === 'serial' ? 'Connecting with Bluetooth Classic...' : 'Connecting to Bluetooth…');
    const plugin = window.Capacitor?.Plugins?.BluetoothLe;
    const connection = transport === 'serial' ? await serialConnection(progress) : plugin ? await nativeConnection(plugin) : await webConnection(progress);
    progress('Bluetooth linked. Starting Shearwater protocol…');
    await new Promise(resolve => setTimeout(resolve, 350));
    const serial = text(await connection.stream.rdbi(0x8010));
    const firmware = text(await connection.stream.rdbi(0x8011));
    const modelData = await connection.stream.rdbi(0x8060);
    const upload = await connection.stream.rdbi(0x8021);
    const baseAddress = be32(upload, 1);
    progress('Reading dive manifest…');
    const manifest = await connection.stream.download(0xe0000000, 0x600);
    const entries = [];
    for (let offset = 0; offset + 0x20 <= manifest.length; offset += 0x20) {
      const header = (manifest[offset] << 8) | manifest[offset + 1];
      if (header === 0xa5c4) entries.push({ fingerprint: Array.from(manifest.slice(offset + 4, offset + 8)).map(x => x.toString(16).padStart(2, '0')).join(''), address: be32(manifest, offset + 20) });
      else if (header !== 0x5a23) break;
    }
    const downloadAll = async onProgress => {
      const dives = [];
      for (let i = 0; i < entries.length; i++) {
        onProgress?.(i + 1, entries.length);
        const raw = await connection.stream.download((baseAddress + entries[i].address) >>> 0, 0xffffff, true);
        dives.push({ id: `shearwater-${serial}-${entries[i].fingerprint}`, ...parseDive(raw, entries.length - i), updatedAt: new Date().toISOString() });
      }
      return dives;
    };
    return { name: connection.device.name || 'Shearwater', serial, firmware, model: modelData[0], baseAddress, logs: entries.length, downloadAll };
  }

  window.SeaBirdsShearwater = { connectAndInspect };
})();
