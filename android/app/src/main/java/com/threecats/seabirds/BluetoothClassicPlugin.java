package com.threecats.seabirds;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothClassic",
    permissions = {
        @Permission(alias = "connect", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class BluetoothClassicPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // Reading blocks until the Perdix answers, so writes must use another worker.
    private final ExecutorService io = Executors.newCachedThreadPool();
    private BluetoothSocket socket;
    private InputStream input;
    private OutputStream output;

    @PluginMethod
    public void pairedDevices(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("connect") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Bluetooth permission is required. Allow Nearby devices, then try again.");
            return;
        }
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { call.reject("This Android device has no Bluetooth adapter."); return; }
            if (!adapter.isEnabled()) { call.reject("Turn on Bluetooth, then try again."); return; }
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice device : bonded) {
                JSObject item = new JSObject();
                item.put("name", device.getName() == null ? "Bluetooth device" : device.getName());
                item.put("address", device.getAddress());
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Bluetooth permission is required. Allow Nearby devices, then try again.", error);
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null) { call.reject("Bluetooth device address is missing."); return; }
        io.execute(() -> {
            closeSocket();
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP);
                    socket.connect();
                } catch (Exception secureError) {
                    closeSocket();
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
                    socket.connect();
                }
                input = socket.getInputStream();
                output = socket.getOutputStream();
                call.resolve();
            } catch (Exception error) {
                closeSocket();
                call.reject("Could not open the Perdix Bluetooth Classic serial connection. Keep it on Wait PC and pair it in Android Bluetooth settings first.", error);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        String encoded = call.getString("data");
        io.execute(() -> {
            try {
                if (output == null) throw new IllegalStateException("Perdix is not connected.");
                output.write(Base64.decode(encoded, Base64.NO_WRAP));
                output.flush();
                call.resolve();
            } catch (Exception error) { call.reject("Bluetooth Classic write failed.", error); }
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        io.execute(() -> {
            try {
                if (input == null) throw new IllegalStateException("Perdix is not connected.");
                int first = input.read();
                if (first < 0) throw new IllegalStateException("Perdix closed the connection.");
                byte[] buffer = new byte[Math.max(1, Math.min(4096, input.available() + 1))];
                buffer[0] = (byte) first;
                int count = 1;
                while (count < buffer.length && input.available() > 0) {
                    int read = input.read(buffer, count, buffer.length - count);
                    if (read <= 0) break;
                    count += read;
                }
                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) { call.reject("Bluetooth Classic read failed.", error); }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(() -> { closeSocket(); call.resolve(); });
    }

    private void closeSocket() {
        try { if (input != null) input.close(); } catch (Exception ignored) {}
        try { if (output != null) output.close(); } catch (Exception ignored) {}
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        input = null; output = null; socket = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
