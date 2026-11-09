package org.liberatv.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Generato da tools/patch-android.js: non modificare a mano.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
