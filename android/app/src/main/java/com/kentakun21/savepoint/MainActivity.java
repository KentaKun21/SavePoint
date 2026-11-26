package com.kentakun21.savepoint;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * The phone's Back button goes to the web app first. The app steps back through its own screens
 * (menus, game page, previous tab). Only when it reports "nothing left to go back to" does the app
 * move to the background; it is never closed by a stray Back press.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
          moveTaskToBack(true);
          return;
        }
        webView.evaluateJavascript(
          "(function(){try{return window.__spBack?window.__spBack():false}catch(e){return false}})()",
          value -> {
            if (!"true".equals(value)) {
              moveTaskToBack(true);
            }
          }
        );
      }
    });
  }
}
