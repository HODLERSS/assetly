import UIKit
import Capacitor
import AVFoundation
import UserNotifications

/// The app's own small native surface, registered by AppViewController. The web side reaches it
/// through `src/lib/native.ts`; every method there degrades to a no-op in the browser.
///
///  - activateAudio / deactivateAudio: the narration audio session. It is claimed only while a
///    brief is actually playing. Claiming it at launch (what 1.0.0 did) is a non-mixable session
///    going active, and iOS answers that by stopping the user's music or podcast every time the
///    app opens, whether or not they ever tap Listen.
///  - setAppearance: the in-app Light / Dark / System choice, applied to the window so the status
///    bar, the keyboard and the native ground behind the web view agree with the page. Remembered
///    so the next cold launch paints the right ground before any JavaScript runs.
///  - getTextScale (+ "textScaleChange"): the iOS text size as a multiple of the default, so the
///    page can follow Dynamic Type.
///  - pushStatus / requestPush / openSettings / apnsEnvironment / setBadge: brief notifications (1.0.3).
///    Capacitor's own plugin can't ask for PROVISIONAL authorization, which is what lets notifications default
///    to on without a system prompt: they are delivered quietly to Notification Center until the reader
///    chooses to keep them (or taps "Turn on alerts" in the app, which asks for the full kind).
@objc(AssetlyNativePlugin)
public class AssetlyNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AssetlyNativePlugin"
    public let jsName = "AssetlyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTextScale", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "apnsEnvironment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    static let appearanceKey = "assetly.appearance"

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(textSizeChanged),
                                               name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // MARK: narration audio session

    @objc func activateAudio(_ call: CAPPluginCall) {
        // .playback is what keeps the brief talking with the screen locked and puts its controls on the
        // lock screen; WKWebView media alone gets the ambient session, which iOS silences on lock.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
            call.resolve(["active": true])
        } catch {
            // not fatal: the brief still plays in the foreground
            CAPLog.print("Assetly: audio session unavailable, \(error.localizedDescription)")
            call.resolve(["active": false])
        }
    }

    @objc func deactivateAudio(_ call: CAPPluginCall) {
        // notifyOthers lets the podcast or playlist the brief interrupted pick up where it left off
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            // AVAudioSession refuses while I/O is still running (a pause that has not landed yet); the
            // next stop or end retries, and iOS reclaims the session when the app suspends regardless
            CAPLog.print("Assetly: audio session still busy, \(error.localizedDescription)")
        }
        call.resolve()
    }

    // MARK: appearance

    static func style(for choice: String?) -> UIUserInterfaceStyle {
        switch choice {
        case "light": return .light
        case "dark": return .dark
        default: return .unspecified
        }
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        let choice = call.getString("style") ?? "system"
        UserDefaults.standard.set(choice, forKey: Self.appearanceKey)
        DispatchQueue.main.async {
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = Self.style(for: choice)
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
    }

    // MARK: Dynamic Type

    /// Body text at the user's size over body text at the default size (17pt): 1.0 at the default,
    /// about 0.82 at the smallest setting and up to 3.1 at the largest accessibility size.
    static func textScale() -> Double {
        Double(UIFont.preferredFont(forTextStyle: .body).pointSize / 17.0)
    }

    @objc func getTextScale(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["value": Self.textScale()]) }
    }

    @objc func textSizeChanged() {
        DispatchQueue.main.async { self.notifyListeners("textScaleChange", data: ["value": Self.textScale()]) }
    }

    // MARK: brief notifications

    static func name(of status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "notDetermined"
        }
    }

    @objc func pushStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["status": Self.name(of: settings.authorizationStatus)])
        }
    }

    /// provisional: true asks quietly (no prompt; delivered to Notification Center only). false asks for the
    /// full kind, which shows the system prompt once: from provisional it upgrades, from denied it does nothing.
    @objc func requestPush(_ call: CAPPluginCall) {
        var options: UNAuthorizationOptions = [.alert, .sound, .badge]
        if call.getBool("provisional") ?? false { options.insert(.provisional) }
        UNUserNotificationCenter.current().requestAuthorization(options: options) { granted, error in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                var out: [String: Any] = ["granted": granted, "status": Self.name(of: settings.authorizationStatus)]
                if let error = error { out["error"] = error.localizedDescription }
                call.resolve(out)
            }
        }
    }

    /// The app's own page in the Settings app, where a denied permission is turned back on.
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.resolve(["opened": false]); return }
            UIApplication.shared.open(url, options: [:]) { ok in call.resolve(["opened": ok]) }
        }
    }

    /// Which APNs host issued this build's device token. The simulator and builds signed with a development
    /// profile (Xcode runs) register with the sandbox; App Store and TestFlight builds, which carry no
    /// embedded profile or a distribution one, with production. The server routes each token to its own host.
    static func apnsEnvironment() -> String {
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<plist"), let end = text.range(of: "</plist>") else { return "production" }
        let plist = String(text[start.lowerBound..<end.upperBound])
        guard let pdata = plist.data(using: .isoLatin1),
              let dict = try? PropertyListSerialization.propertyList(from: pdata, format: nil) as? [String: Any],
              let ents = dict["Entitlements"] as? [String: Any],
              let aps = ents["aps-environment"] as? String else { return "production" }
        return aps == "development" ? "sandbox" : "production"
        #endif
    }

    @objc func apnsEnvironment(_ call: CAPPluginCall) {
        call.resolve(["environment": Self.apnsEnvironment()])
    }

    /// The app icon badge. A brief push sets 1; opening the app clears it, and with 0 the delivered briefs leave
    /// Notification Center too. (Capacitor's removeAllDeliveredNotifications refuses until this launch's token
    /// callback has fired, so at launch it silently did nothing and read briefs piled up.)
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        if count == 0 { UNUserNotificationCenter.current().removeAllDeliveredNotifications() }
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(count) { _ in call.resolve() }
        } else {
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }
}
