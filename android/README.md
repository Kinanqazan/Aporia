# Aporia Android app

This is a small Android WebView app for connecting to your self-hosted Aporia server. The APK does not contain the server or its SQLite database. On first launch, enter the HTTPS address of your Aporia instance. To change it later, open Aporia's sidebar, choose **Settings**, then **Change server address** under **App**.

Deploy the updated Aporia web app to your server for that Settings action to appear in the Android app. If the configured host becomes unreachable, the app shows a recovery screen with **Try again** and **Change server address** actions.

The app receives shared text, web links, images, and files from Android's Share menu. Choose a destination from the full page tree, including locked pages. Select a locked page and tap **Unlock page** in the pop-up, then add the shared item; that page stays unlocked. Android sharing supports up to five files, 10 MB per file, and 25 MB total. Supported images appear inline; other formats become file attachments that you can open or download. Editor file uploads support up to 25 MB per attachment.

The Android APK is a WebView client that loads the configured Aporia server. Changes to the link picker and bookmark editor are delivered by deploying the updated web app to your server; rebuilding the APK is only needed when the native Android app changes.

Selecting editable document text adds **Format** to Android's text selection menu (possibly under **⋮**). It opens a panel for bold, italic, strikethrough, inline code, links, text color, and highlights. Cut, Copy, Paste, and Select all keep their native behavior. This feature requires both the updated APK and the updated web app deployed on your server. The panel closes with its Close button, a tap outside, or Android Back.

## Build the APK

Install a JDK 17 and Android SDK with Android platform 35 and build tools 35.0.0. Set `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), then run this from the `android` directory:

```powershell
.\build-apk.ps1
```

The script builds the same automatically signed debug APK as before, then copies it to `Aporia.apk` in this directory and clears the generated `app\build` output folder. The filename is just a friendly name; the app itself is still the tested debug build. Install it with Android's package installer or `adb install -r .\Aporia.apk`.

Committing an updated `Aporia.apk` to `main` automatically creates or updates its GitHub Release, using `versionName` from `app\build.gradle` for the release tag. Building it locally does not publish it until the updated file is committed and pushed.

Use an HTTPS Caddy address. The app rejects HTTP because Aporia's production session cookie is secure. Android apps do not trust user-installed CA certificates by default; this app opts in to the phone's user CA store so a Caddy internal CA installed on the phone can validate. Normal certificate-chain and hostname checks remain enabled. A new hostname has a separate WebView cookie store, so you may need to sign in again after changing servers.
