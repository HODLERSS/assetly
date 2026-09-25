import UIKit
import Capacitor

/// The Capacitor host, with the app's own native plugin registered and the ground behind the web
/// view following the appearance.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AssetlyNativePlugin())
        // A fixed colour in capacitor.config (1.0.0 used the light ground, #F4F5F7) is what flashed a
        // light frame between the dark launch screen and the dark page. The named colour has a light and
        // a dark value, so the web view's ground, the overscroll area and the launch screen always match.
        let ground = UIColor(named: "Ground") ?? .systemBackground
        webView?.backgroundColor = ground
        webView?.scrollView.backgroundColor = ground
    }
}
