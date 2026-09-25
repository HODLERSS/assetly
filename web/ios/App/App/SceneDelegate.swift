import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // the in-app appearance choice (Settings) and the matching ground, before the first frame: the
        // web view is transparent until its first paint, so whatever is behind it is what the user sees
        let choice = UserDefaults.standard.string(forKey: AssetlyNativePlugin.appearanceKey)
        window?.overrideUserInterfaceStyle = AssetlyNativePlugin.style(for: choice)
        window?.backgroundColor = UIColor(named: "Ground") ?? .systemBackground
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
