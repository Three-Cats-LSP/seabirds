package com.threecats.seabirds;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BluetoothClassicPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
