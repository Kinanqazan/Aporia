package com.kinanqazan.aporia;

import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/** Extends WebView's selection menu while delegating all built-in actions. */
final class FormattingWebView extends WebView {
	private static final int FORMAT_ITEM_ID = R.id.aporia_format_selection;
	private boolean selectionAvailable;
	private boolean panelOpen;
	private ActionMode selectionMode;

	FormattingWebView(Context context) {
		super(context);
		addJavascriptInterface(new FormattingBridge(), "AporiaFormatting");
	}

	boolean dismissFormattingPanel() {
		if (!panelOpen) return false;
		evaluateJavascript("window.__APORIA_FORMATTING__?.close()", null);
		return true;
	}

	void resetFormattingState() {
		selectionAvailable = false;
		panelOpen = false;
		if (selectionMode != null) selectionMode.finish();
	}

	@Override
	public ActionMode startActionMode(ActionMode.Callback callback) {
		return startActionMode(callback, ActionMode.TYPE_PRIMARY);
	}

	@Override
	public ActionMode startActionMode(ActionMode.Callback callback, int type) {
		return super.startActionMode(new ActionMode.Callback2() {
			private void updateFormatItem(Menu menu) {
				MenuItem item = menu.findItem(FORMAT_ITEM_ID);
				if (!selectionAvailable || panelOpen) {
					if (item != null) menu.removeItem(FORMAT_ITEM_ID);
				} else if (item == null) {
					menu.add(Menu.NONE, FORMAT_ITEM_ID, 10, "Format")
							.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);
				}
			}

			@Override
			public boolean onCreateActionMode(ActionMode mode, Menu menu) {
				if (!callback.onCreateActionMode(mode, menu)) return false;
				selectionMode = mode;
				updateFormatItem(menu);
				return true;
			}

			@Override
			public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
				callback.onPrepareActionMode(mode, menu);
				updateFormatItem(menu);
				return true;
			}

			@Override
			public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
				if (item.getItemId() != FORMAT_ITEM_ID) {
					return callback.onActionItemClicked(mode, item);
				}
				// Capture the editor selection in JS before finish() clears native selection.
				evaluateJavascript("window.__APORIA_FORMATTING__?.open() === true", result -> {
					if ("true".equals(result)) {
						mode.finish();
					}
				});
				return true;
			}

			@Override
			public void onDestroyActionMode(ActionMode mode) {
				if (selectionMode == mode) selectionMode = null;
				callback.onDestroyActionMode(mode);
			}

			@Override
			public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
				if (callback instanceof ActionMode.Callback2) {
					((ActionMode.Callback2) callback).onGetContentRect(mode, view, outRect);
				} else {
					super.onGetContentRect(mode, view, outRect);
				}
			}
		}, type);
	}

	private final class FormattingBridge {
		@JavascriptInterface
		public void setSelectionAvailable(boolean available) {
			post(() -> {
				if (selectionAvailable == available) return;
				selectionAvailable = available;
				if (selectionMode != null) selectionMode.invalidate();
			});
		}

		@JavascriptInterface
		public void setPanelOpen(boolean open) {
			post(() -> {
				panelOpen = open;
				if (selectionMode != null) selectionMode.invalidate();
			});
		}
	}
}
