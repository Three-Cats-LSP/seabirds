(function () {
  'use strict';

  const SERVICE = 'fe25c237-0ece-443c-b0aa-e02033e7029d';
  const END = 0xc0, ESC = 0xdb, ESC_END = 0xdc, ESC_ESC = 0xdd;
  const timeout = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  const bytes = value => {
    if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === 'string') return new Uint8Array((value.match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
    return new Uint8Array(value || []);
  };
  const view = value => new DataView(value.buffer, value.byteOffset, value.byteLength);

  class Stream {
    constructor(write) { this.writeChunk = write; this.queue = []; this.waiters = []; this.packet = []; this.escaped = false; }
    push(value) {
      const data = bytes(value);
      // Shearwater V1 BLE notifications have a two-byte frame count/index prefix.
      for (let i = data.length >= 2 ? 2 : 0; i < data.length; i++) {
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
    async download(address, size) {
      const init = await this.transfer(new Uint8Array([0x35, 0x00, 0x34, address >>> 24, address >>> 16, address >>> 8, address, size >>> 16, size >>> 8, size]));
      if (init[0] !== 0x75) throw new Error('Shearwater rejected the log manifest request.');
      const output = [];
      for (let block = 1; output.length < size; block = (block + 1) & 255) {
        const response = await this.transfer(new Uint8Array([0x36, block]), 8000);
        if (response[0] !== 0x76 || response[1] !== block) throw new Error('Unexpected Shearwater manifest block.');
        output.push(...response.slice(2));
      }
      const quit = await this.transfer(new Uint8Array([0x37]));
      if (quit[0] !== 0x77) throw new Error('Shearwater did not close the manifest transfer cleanly.');
      return new Uint8Array(output.slice(0, size));
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
        server = device.gatt.connected ? device.gatt : await device.gatt.connect();
        if (!server.connected) throw new Error('GATT connection closed immediately.');
        service = await server.getPrimaryService(SERVICE);
        break;
      } catch (error) {
        lastError = error;
        if (device.gatt.connected) device.gatt.disconnect();
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!service) throw new Error(`Windows disconnected before Shearwater service discovery after 3 attempts. ${lastError?.message || ''}`.trim());
    const selected = selectCharacteristics(await service.getCharacteristics());
    const stream = new Stream(data => selected.write.properties.writeWithoutResponse ? selected.write.writeValueWithoutResponse(data) : selected.write.writeValueWithResponse(data));
    selected.notify.addEventListener('characteristicvaluechanged', event => stream.push(event.target.value));
    await selected.notify.startNotifications();
    return { device, stream };
  }

  const text = data => new TextDecoder().decode(data).replace(/\0/g, '').trim();
  const be32 = (d, o) => ((d[o] * 0x1000000) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3]) >>> 0;
  async function connectAndInspect(progress) {
    progress('Connecting to Bluetooth…');
    const plugin = window.Capacitor?.Plugins?.BluetoothLe;
    const connection = plugin ? await nativeConnection(plugin) : await webConnection(progress);
    progress('Bluetooth linked. Starting Shearwater protocol…');
    await new Promise(resolve => setTimeout(resolve, 350));
    const serial = text(await connection.stream.rdbi(0x8010));
    const firmware = text(await connection.stream.rdbi(0x8011));
    const modelData = await connection.stream.rdbi(0x8060);
    const upload = await connection.stream.rdbi(0x8021);
    const baseAddress = be32(upload, 1);
    progress('Reading dive manifest…');
    const manifest = await connection.stream.download(0xe0000000, 0x600);
    let logs = 0;
    for (let offset = 0; offset + 0x20 <= manifest.length; offset += 0x20) {
      const header = (manifest[offset] << 8) | manifest[offset + 1];
      if (header === 0xa5c4) logs++; else if (header !== 0x5a23) break;
    }
    return { name: connection.device.name || 'Shearwater', serial, firmware, model: modelData[0], baseAddress, logs };
  }

  window.SeaBirdsShearwater = { connectAndInspect };
})();
