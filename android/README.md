# Aporia Android app

This is a small Android WebView shell for the existing hosted Aporia app. The APK does not contain the Aporia server or SQLite database. On first launch, enter the HTTPS origin of your Aporia instance. To change it later, open Aporia's sidebar, choose **Settings**, then **Change server address** under **App**.

Deploy the updated Aporia web app for that Settings action to appear in the Android shell. The error dialog also keeps a **Change server** action if the configured host becomes unreachable.

The app receives shared text and web links from Android's Share menu. It sends them to the configured Aporia server, which creates a new page and opens it. Image and file sharing are not included in this first version.

## Build the APK

Install a JDK 17 and Android SDK with Android platform 35 and build tools 35.0.0. Set `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), then run this from the `android` directory:

```powershell
.\build-apk.ps1
```

The script builds the same automatically signed debug APK as before, then copies it to `Aporia.apk` in this directory and clears the generated `app\build` output folder. The filename is just a friendly name; the app itself is still the tested debug build. Install it with Android's package installer or `adb install -r .\Aporia.apk`.

Use an HTTPS Caddy address. The app rejects HTTP because Aporia's production session cookie is secure. Android apps do not trust user-installed CA certificates by default; this app opts in to the phone's user CA store so a Caddy internal CA installed on the phone can validate. Normal certificate-chain and hostname checks remain enabled. A new hostname has a separate WebView cookie store, so you may need to sign in again after changing servers.
