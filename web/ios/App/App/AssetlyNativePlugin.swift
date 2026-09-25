import UIKit
import Capacitor
import AVFoundation

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
@objc(AssetlyNativePlugin)
public class AssetlyNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AssetlyNativePlugin"
    public let jsName = "AssetlyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTextScale", returnType: CAPPluginReturnPromise)
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
}
