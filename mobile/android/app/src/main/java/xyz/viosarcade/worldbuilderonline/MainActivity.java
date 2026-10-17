package xyz.viosarcade.worldbuilderonline;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// The game on the whole screen: the status and navigation bars hidden, back for a moment with a
// swipe from the edge (as the website's full screen is, in a browser).  Landscape, either way up
// (AndroidManifest.xml), unless the page asks for portrait or for it to turn with the phone (the
// setting Screen: window.WorldBuilderAndroid.setOrientation, src/online/android.js).
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        immersive();
        getBridge().getWebView().addJavascriptInterface(new Screen(), "WorldBuilderAndroid");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private void immersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private class Screen {
        @JavascriptInterface
        public void setOrientation(String way) {
            final int o = "portrait".equals(way) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : "any".equals(way) ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
            runOnUiThread(() -> setRequestedOrientation(o));
        }
    }
}
