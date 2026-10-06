package com.kinanqazan.aporia;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.UUID;

public class MainActivity extends Activity {
	private static final String PREFS = "aporia_android";
	private static final String KEY_SERVER = "server_url";
	private static final String KEY_PENDING_SHARES = "pending_shares";
	private static final int FILE_CHOOSER_REQUEST = 4071;
	private static final Pattern SHARED_URL_PATTERN = Pattern.compile("https?://[^\\s<>\\\"']+", Pattern.CASE_INSENSITIVE);
	private static final int INK = Color.rgb(25, 25, 25);
	private static final int PAPER = Color.rgb(250, 249, 247);
	private static final int ACCENT = Color.rgb(166, 77, 83);

	private final Handler mainHandler = new Handler(Looper.getMainLooper());
	private FrameLayout root;
	private WebView webView;
	private EditText serverAddressInput;
	private ValueCallback<Uri[]> fileChooserCallback;
	private String serverUrl = "";

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		enableEdgeToEdge();

		root = new FrameLayout(this);
		applySystemBarColor(Color.WHITE);
		root.setOnApplyWindowInsetsListener((view, insets) -> {
			int left;
			int top;
			int right;
			int bottom;
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
				Insets safeArea = insets.getInsets(
						WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
				left = safeArea.left;
				top = safeArea.top;
				right = safeArea.right;
				bottom = safeArea.bottom;
			} else {
				left = insets.getSystemWindowInsetLeft();
				top = insets.getSystemWindowInsetTop();
				right = insets.getSystemWindowInsetRight();
				bottom = insets.getSystemWindowInsetBottom();
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && insets.getDisplayCutout() != null) {
					android.view.DisplayCutout cutout = insets.getDisplayCutout();
					left = Math.max(left, cutout.getSafeInsetLeft());
					top = Math.max(top, cutout.getSafeInsetTop());
					right = Math.max(right, cutout.getSafeInsetRight());
					bottom = Math.max(bottom, cutout.getSafeInsetBottom());
				}
			}

			boolean showingWebApp = webView != null;
			view.setPadding(left, showingWebApp ? 0 : top, right, showingWebApp ? 0 : bottom);
			return insets;
		});
		setContentView(root);

		serverUrl = getPreferences(MODE_PRIVATE).getString(KEY_SERVER, "");
		captureShareIntent(getIntent());
		if (serverUrl.isEmpty()) {
			showServerSetup("");
		} else {
			showWebApp();
		}
	}

	private void enableEdgeToEdge() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			getWindow().setDecorFitsSystemWindows(false);
		} else {
			View decor = getWindow().getDecorView();
			decor.setSystemUiVisibility(decor.getSystemUiVisibility()
					| View.SYSTEM_UI_FLAG_LAYOUT_STABLE
					| View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
					| View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
		}
		getWindow().setStatusBarColor(Color.TRANSPARENT);
		getWindow().setNavigationBarColor(Color.TRANSPARENT);
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
			getWindow().setStatusBarContrastEnforced(false);
			getWindow().setNavigationBarContrastEnforced(false);
		}
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
		captureShareIntent(intent);
		if (webView != null) {
			deliverPendingShares();
		}
	}

	@Override
	protected void onResume() {
		super.onResume();
		if (webView != null) {
			webView.onResume();
			deliverPendingShares();
		}
	}

	@Override
	protected void onPause() {
		if (webView != null) webView.onPause();
		super.onPause();
	}

	@Override
	public void onBackPressed() {
		if (webView != null && webView.canGoBack()) {
			webView.goBack();
			return;
		}
		super.onBackPressed();
	}

	private void showServerSetup(String currentValue) {
		root.removeAllViews();
		applySystemBarColor(PAPER);
		ScrollView scroll = new ScrollView(this);
		LinearLayout card = new LinearLayout(this);
		card.setOrientation(LinearLayout.VERTICAL);
		card.setPadding(dp(28), dp(40), dp(28), dp(28));
		card.setGravity(Gravity.CENTER_VERTICAL);
		scroll.addView(card, new ScrollView.LayoutParams(
				ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.MATCH_PARENT));
		root.addView(scroll, new FrameLayout.LayoutParams(
				FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

		TextView title = new TextView(this);
		title.setText("Connect to Aporia");
		title.setTextColor(INK);
		title.setTextSize(28);
		title.setTypeface(null, android.graphics.Typeface.BOLD);
		card.addView(title);

		TextView description = new TextView(this);
		description.setText("Enter your Aporia server's HTTPS address. You can change it later in Settings.");
		description.setTextColor(Color.rgb(95, 91, 88));
		description.setTextSize(16);
		LinearLayout.LayoutParams descriptionParams = new LinearLayout.LayoutParams(
				LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
		descriptionParams.topMargin = dp(12);
		card.addView(description, descriptionParams);

		serverAddressInput = new EditText(this);
		serverAddressInput.setSingleLine(true);
		serverAddressInput.setTextSize(16);
		serverAddressInput.setHint("https://notes.example.com");
		serverAddressInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
				| android.text.InputType.TYPE_TEXT_VARIATION_URI);
		serverAddressInput.setText(currentValue);
		serverAddressInput.setSelectAllOnFocus(true);
		LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
				LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
		inputParams.topMargin = dp(24);
		card.addView(serverAddressInput, inputParams);

		Button connect = makeButton("Connect");
		LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
				LinearLayout.LayoutParams.MATCH_PARENT, dp(48));
		buttonParams.topMargin = dp(18);
		card.addView(connect, buttonParams);
		connect.setOnClickListener(view -> saveServerAddress(serverAddressInput.getText().toString()));
	}

	private void saveServerAddress(String entered) {
		String normalized;
		try {
			normalized = normalizeServerAddress(entered);
		} catch (IllegalArgumentException error) {
			serverAddressInput.setError(error.getMessage());
			return;
		}
		serverUrl = normalized;
		getPreferences(MODE_PRIVATE).edit().putString(KEY_SERVER, serverUrl).apply();
		showWebApp();
	}

	private String normalizeServerAddress(String value) {
		String input = value == null ? "" : value.trim();
		if (input.isEmpty()) throw new IllegalArgumentException("Enter your server address.");
		if (!input.contains("://")) input = "https://" + input;

		final URI uri;
		try {
			uri = URI.create(input).normalize();
		} catch (IllegalArgumentException error) {
			throw new IllegalArgumentException("Enter a valid HTTPS address.");
		}
		if (!"https".equalsIgnoreCase(uri.getScheme())) {
			throw new IllegalArgumentException("Use HTTPS so your Aporia sign-in stays secure.");
		}
		if (uri.getHost() == null || uri.getUserInfo() != null) {
			throw new IllegalArgumentException("Enter a server hostname, without a username or password.");
		}
		String path = uri.getPath();
		if ((path != null && !path.isEmpty() && !"/".equals(path))
				|| uri.getQuery() != null || uri.getFragment() != null) {
			throw new IllegalArgumentException("Enter the server origin only, without a path or query.");
		}
		return "https://" + uri.getRawAuthority();
	}

	private void showWebApp() {
		root.removeAllViews();
		webView = new WebView(this);
		webView.setBackgroundColor(Color.WHITE);
		WebSettings settings = webView.getSettings();
		settings.setJavaScriptEnabled(true);
		settings.setDomStorageEnabled(true);
		settings.setDatabaseEnabled(true);
		settings.setAllowFileAccess(false);
		settings.setAllowContentAccess(true);
		settings.setSupportMultipleWindows(false);
		settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
		settings.setUserAgentString(settings.getUserAgentString() + " AporiaAndroid");
		CookieManager.getInstance().setAcceptCookie(true);
		webView.addJavascriptInterface(new SystemBarBridge(), "AporiaSystemBar");
		webView.setWebViewClient(new AporiaWebViewClient());
		webView.setWebChromeClient(new AporiaWebChromeClient());
		root.addView(webView, new FrameLayout.LayoutParams(
				FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
		root.setPadding(0, 0, 0, 0);
		root.requestApplyInsets();
		webView.loadUrl(serverUrl);
	}

	private void applySystemBarColor(int color) {
		root.setBackgroundColor(color);

		double brightness = (0.299 * Color.red(color) + 0.587 * Color.green(color)
				+ 0.114 * Color.blue(color)) / 255.0;
		boolean lightSurface = brightness > 0.55;
		View decor = getWindow().getDecorView();
		int flags = decor.getSystemUiVisibility();
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			flags = lightSurface
					? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
					: flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
		}
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			flags = lightSurface
					? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
					: flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
		}
		decor.setSystemUiVisibility(flags);
	}

	private void syncSystemBarsFromPage(WebView view) {
		String script = "(function(){const root=document.documentElement;"
				+ "const update=()=>{const color=getComputedStyle(root).getPropertyValue('--bg-canvas').trim();"
				+ "if(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color))AporiaSystemBar.setSurfaceColor(color);};"
				+ "if(!window.__APORIA_SYSTEM_BAR_OBSERVER__){"
				+ "new MutationObserver(update).observe(root,{attributes:true,attributeFilter:['class']});"
				+ "window.__APORIA_SYSTEM_BAR_OBSERVER__=true;}update();})();";
		view.evaluateJavascript(script, null);
	}

	private class SystemBarBridge {
		@JavascriptInterface
		public void setSurfaceColor(String cssColor) {
			if (cssColor == null || !cssColor.matches("#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?")) return;
			final int color;
			try {
				color = Color.parseColor(cssColor);
			} catch (IllegalArgumentException ignored) {
				return;
			}
			mainHandler.post(() -> {
				if (!isFinishing() && root != null) applySystemBarColor(color);
			});
		}
	}

	private void showServerDialog() {
		EditText input = new EditText(this);
		input.setSingleLine(true);
		input.setInputType(android.text.InputType.TYPE_CLASS_TEXT
				| android.text.InputType.TYPE_TEXT_VARIATION_URI);
		input.setText(serverUrl);
		input.setSelectAllOnFocus(true);
		int horizontalPadding = dp(24);
		LinearLayout wrapper = new LinearLayout(this);
		wrapper.setPadding(horizontalPadding, dp(8), horizontalPadding, 0);
		wrapper.addView(input, new LinearLayout.LayoutParams(
				LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

		AlertDialog dialog = new AlertDialog.Builder(this)
				.setTitle("Aporia server")
				.setMessage("Change the HTTPS address used by this app.")
				.setView(wrapper)
				.setNegativeButton("Cancel", null)
				.setPositiveButton("Reconnect", null)
				.create();
		dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
			try {
				String next = normalizeServerAddress(input.getText().toString());
				serverUrl = next;
				getPreferences(MODE_PRIVATE).edit().putString(KEY_SERVER, serverUrl).apply();
				if (webView != null) {
					webView.stopLoading();
					webView.destroy();
					webView = null;
				}
				dialog.dismiss();
				showWebApp();
			} catch (IllegalArgumentException error) {
				input.setError(error.getMessage());
			}
		}));
		dialog.show();
	}

	private Button makeButton(String label) {
		Button button = new Button(this);
		button.setText(label);
		button.setTextColor(Color.WHITE);
		button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(ACCENT));
		return button;
	}

	private int dp(float value) {
		return Math.round(value * getResources().getDisplayMetrics().density);
	}

	private void captureShareIntent(Intent intent) {
		if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
		String type = intent.getType();
		if (type != null && !type.startsWith("text/")) {
			Toast.makeText(this, "Aporia currently accepts shared text and links.", Toast.LENGTH_LONG).show();
			return;
		}

		CharSequence subjectValue = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
		CharSequence textValue = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
		String subject = subjectValue == null ? "" : subjectValue.toString().trim();
		String text = textValue == null ? "" : textValue.toString().trim();
		if (text.isEmpty() && intent.getData() != null) text = intent.getData().toString();
		if (subject.isEmpty() && text.isEmpty()) return;
		String url = findSharedUrl(text);

		try {
			JSONObject payload = new JSONObject();
			payload.put("id", UUID.randomUUID().toString());
			payload.put("title", subject);
			payload.put("text", text);
			payload.put("url", url);
			JSONArray pending = readPendingShares();
			pending.put(payload);
			getPreferences(MODE_PRIVATE).edit().putString(KEY_PENDING_SHARES, pending.toString()).apply();
		} catch (JSONException ignored) {
			Toast.makeText(this, "Could not prepare the shared content.", Toast.LENGTH_SHORT).show();
		}
	}

	private String findSharedUrl(String text) {
		Matcher matcher = SHARED_URL_PATTERN.matcher(text == null ? "" : text);
		if (!matcher.find()) return "";
		String candidate = matcher.group();
		while (!candidate.isEmpty() && ".,;:!?)]}".indexOf(candidate.charAt(candidate.length() - 1)) >= 0) {
			candidate = candidate.substring(0, candidate.length() - 1);
		}
		try {
			URI uri = URI.create(candidate);
			if (uri.getHost() != null && ("https".equalsIgnoreCase(uri.getScheme())
					|| "http".equalsIgnoreCase(uri.getScheme()))) return candidate;
		} catch (IllegalArgumentException ignored) {
			// Shared text can include malformed URL-looking text; keep it as plain text.
		}
		return "";
	}

	private JSONArray readPendingShares() {
		String saved = getPreferences(MODE_PRIVATE).getString(KEY_PENDING_SHARES, "[]");
		try {
			return new JSONArray(saved);
		} catch (JSONException ignored) {
			return new JSONArray();
		}
	}

	private void deliverPendingShares() {
		if (webView == null || webView.getProgress() < 100) return;
		Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
		if (!isSameOrigin(current)) return;

		JSONArray pending = readPendingShares();
		for (int index = 0; index < pending.length(); index++) {
			JSONObject payload = pending.optJSONObject(index);
			if (payload == null) continue;
			String script = "(function(){const p=JSON.parse(" + JSONObject.quote(payload.toString()) + ");"
					+ "const q=window.__APORIA_NATIVE_SHARE_QUEUE__||(window.__APORIA_NATIVE_SHARE_QUEUE__=[]);"
					+ "if(!q.some(x=>x.id===p.id))q.push(p);"
					+ "window.dispatchEvent(new Event('aporia-native-share'));})();";
			webView.evaluateJavascript(script, null);
		}
	}

	private void acknowledgeShare(String id) {
		JSONArray pending = readPendingShares();
		JSONArray remaining = new JSONArray();
		for (int index = 0; index < pending.length(); index++) {
			JSONObject payload = pending.optJSONObject(index);
			if (payload != null && !id.equals(payload.optString("id"))) remaining.put(payload);
		}
		getPreferences(MODE_PRIVATE).edit().putString(KEY_PENDING_SHARES, remaining.toString()).apply();
	}

	private boolean isSameOrigin(Uri uri) {
		if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
		Uri configured = Uri.parse(serverUrl);
		return configured.getHost() != null
				&& configured.getHost().equalsIgnoreCase(uri.getHost())
				&& effectiveHttpsPort(configured) == effectiveHttpsPort(uri);
	}

	private int effectiveHttpsPort(Uri uri) {
		return uri.getPort() == -1 ? 443 : uri.getPort();
	}

	private void showConnectionError(String description) {
		if (isFinishing()) return;
		new AlertDialog.Builder(this)
				.setTitle("Could not reach Aporia")
				.setMessage("Check that this server address is current and reachable over HTTPS.\n\n" + description)
				.setNegativeButton("Change server", (dialog, which) -> showServerDialog())
				.setPositiveButton("Retry", (dialog, which) -> {
					if (webView != null) webView.reload();
				})
				.show();
	}

	private boolean handleWebNavigation(Uri uri) {
		if ("aporia-native".equalsIgnoreCase(uri.getScheme()) && "share-ack".equalsIgnoreCase(uri.getHost())) {
			String shareId = uri.getQueryParameter("id");
			if (shareId != null) acknowledgeShare(shareId);
			return true;
		}
		if ("aporia-native".equalsIgnoreCase(uri.getScheme()) && "change-server".equalsIgnoreCase(uri.getHost())) {
			showServerDialog();
			return true;
		}
		if (isSameOrigin(uri)) return false;
		if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())
				|| "mailto".equalsIgnoreCase(uri.getScheme()) || "tel".equalsIgnoreCase(uri.getScheme())) {
			try {
				startActivity(new Intent(Intent.ACTION_VIEW, uri));
			} catch (ActivityNotFoundException ignored) {
				Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show();
			}
		}
		return true;
	}

	private class AporiaWebViewClient extends WebViewClient {
		@Override
		public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
			return handleWebNavigation(request.getUrl());
		}

		@Override
		public boolean shouldOverrideUrlLoading(WebView view, String url) {
			return handleWebNavigation(Uri.parse(url));
		}

		@Override
		public void onPageFinished(WebView view, String url) {
			super.onPageFinished(view, url);
			if (isSameOrigin(Uri.parse(url))) syncSystemBarsFromPage(view);
			deliverPendingShares();
		}

		@Override
		public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
			super.doUpdateVisitedHistory(view, url, isReload);
			mainHandler.postDelayed(MainActivity.this::deliverPendingShares, 250);
		}

		@Override
		public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
			super.onReceivedError(view, request, error);
			if (request.isForMainFrame()) showConnectionError(error.getDescription().toString());
		}

		@Override
		public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
			handler.cancel();
			showConnectionError("The server certificate could not be verified.");
		}
	}

	private class AporiaWebChromeClient extends WebChromeClient {
		@Override
		public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
			if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
			fileChooserCallback = callback;
			Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
			picker.addCategory(Intent.CATEGORY_OPENABLE);
			picker.setType("*/*");
			picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
			try {
				startActivityForResult(Intent.createChooser(picker, "Choose a file"), FILE_CHOOSER_REQUEST);
			} catch (ActivityNotFoundException error) {
				fileChooserCallback = null;
				return false;
			}
			return true;
		}
	}

	@Override
	protected void onActivityResult(int requestCode, int resultCode, Intent data) {
		super.onActivityResult(requestCode, resultCode, data);
		if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;
		Uri[] results = null;
		if (resultCode == RESULT_OK && data != null) {
			if (data.getClipData() != null) {
				int count = data.getClipData().getItemCount();
				results = new Uri[count];
				for (int index = 0; index < count; index++) {
					results[index] = data.getClipData().getItemAt(index).getUri();
				}
			} else if (data.getData() != null) {
				results = new Uri[] { data.getData() };
			}
		}
		fileChooserCallback.onReceiveValue(results);
		fileChooserCallback = null;
	}
}
