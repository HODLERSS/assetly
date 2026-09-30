import XCTest

/// Brief notifications (1.0.3) in the native shell. Run by run-push-sim.sh on a freshly installed app:
///  1. sign in -> notifications default ON through PROVISIONAL authorization: no system prompt ever appears
///  2. Settings shows the switch On with "Arriving quietly"; Off and back On work
/// The host script then checks push_tokens for the simulator's token and pushes to it.
final class PushUITests: XCTestCase {

    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private func env(_ k: String) -> String { ProcessInfo.processInfo.environment[k] ?? "" }
    private func beat(_ s: TimeInterval = 1.2) { Thread.sleep(forTimeInterval: s) }

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
    }

    /// Screenshots go straight to the host (a simulator test runs on the Mac), named for the step.
    private func shot(_ name: String) {
        let dir = env("PUSH_SHOT_DIR")
        guard !dir.isEmpty else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    private func fill(_ field: XCUIElement, _ text: String, _ what: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 20), "missing \(what)")
        field.tap()
        XCTAssertTrue(app.keyboards.element.waitForExistence(timeout: 10), "no keyboard for \(what)")
        beat(0.6)
        app.typeText(text)
        beat(0.6)
    }

    private func tapReturn() {
        for n in ["Return", "return", "go", "Go", "Done"] where app.keyboards.buttons[n].exists {
            app.keyboards.buttons[n].tap(); beat(0.8); return
        }
    }

    private func assertNoSystemPrompt(_ when: String) {
        XCTAssertFalse(springboard.alerts.firstMatch.waitForExistence(timeout: 3), "a system prompt appeared \(when)")
        XCTAssertFalse(app.alerts.firstMatch.exists, "an alert appeared \(when)")
    }

    private func signInIfNeeded() {
        if app.buttons["Use a password instead"].waitForExistence(timeout: 30) {
            app.buttons["Use a password instead"].tap()
            beat()
            fill(app.textFields.firstMatch, env("PUSH_EMAIL"), "the email field")
            fill(app.secureTextFields.firstMatch, env("PUSH_PASSWORD"), "the password field")
            tapReturn()
        }
    }

    func testProvisionalByDefaultThenSettingsSwitch() throws {
        app.launch()
        beat(3)
        signInIfNeeded()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "Home did not load")
        beat(8)   // registration + token save happen right after sign-in
        assertNoSystemPrompt("after sign-in")
        shot("01-home-after-signin")

        app.buttons["Settings"].tap()
        beat(2)
        let toggle = app.switches["Brief notifications"].exists ? app.switches["Brief notifications"] : app.buttons["Brief notifications"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "no Brief notifications switch")
        for _ in 0..<6 where !toggle.isHittable { app.swipeUp(); beat(0.8) }   // the card sits below the fold
        XCTAssertTrue(toggle.isHittable, "the switch never came into view")
        XCTAssertTrue(app.staticTexts["Arriving quietly in Notification Center."].exists, "not provisional")
        shot("02-settings-on-quiet")
        toggle.tap()
        beat(2)
        XCTAssertFalse(app.staticTexts["Arriving quietly in Notification Center."].exists)
        shot("03-settings-off")
        toggle.tap()
        beat(4)
        assertNoSystemPrompt("after switching back on")
        XCTAssertTrue(app.staticTexts["Arriving quietly in Notification Center."].waitForExistence(timeout: 5))
        shot("04-settings-on-again")
    }

    /// "Turn on alerts" (Settings) shows the one-time system prompt; Allow upgrades provisional to authorized.
    func testTurnOnAlertsUpgrades() throws {
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "Home did not load (sign in first)")
        app.buttons["Settings"].tap()
        beat(2)
        let alerts = app.buttons["Turn on alerts"]
        XCTAssertTrue(alerts.waitForExistence(timeout: 10), "no Turn on alerts")
        for _ in 0..<6 where !alerts.isHittable { app.swipeUp(); beat(0.8) }
        alerts.tap()
        let prompt = springboard.alerts.firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout: 10), "the system prompt did not appear")
        shot("05-system-prompt")
        prompt.buttons["Allow"].tap()
        beat(3)
        XCTAssertFalse(app.staticTexts["Arriving quietly in Notification Center."].exists, "still provisional after Allow")
        shot("06-settings-alerts-on")
    }

    /// A brief push, tapped from the lock screen banner, opens that brief read in full on Home. The host script
    /// (run-push-sim.sh tap) sends the push with `xcrun simctl push` while this waits on the Home screen.
    func testTapOpensBrief() throws {
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "Home did not load (sign in first)")
        app.buttons["Settings"].tap()   // start away from Home: the tap must bring the reader back
        beat(2)
        XCUIDevice.shared.press(.home)
        // wait on the Home screen for the banner and tap it while it is up (it lasts a few seconds)
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'Morning brief' AND label CONTAINS[c] 'now'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 150), "no banner arrived")
        shot("07-banner")
        banner.tap()
        beat(2)
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        let title = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH[c] 'Morning Brief'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 20), "the Morning brief did not open")
        beat(2)
        shot("08-tap-opened-morning")
    }

    /// Fresh install: after two briefs are opened the soft ask appears on Home; "Not now" removes it for good.
    func testSoftAskAfterTwoBriefs() throws {
        app.launch()
        beat(3)
        signInIfNeeded()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "Home did not load")
        beat(6)
        assertNoSystemPrompt("after sign-in")
        let card = app.otherElements["Brief alerts"]
        XCTAssertFalse(card.exists, "asked before the reader used a brief")
        // open two editions' full read
        for chip in ["Morning", "Korea close"] {
            // WebKit folds the chips of a role=group into the group: reach them as any element by label
            let b = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", chip)).firstMatch
            if !b.waitForExistence(timeout: 30) {
                shot("dbg-no-chip")
                print("PUSHDBG tree: \(app.debugDescription.prefix(6000))")
            }
            b.tap(); beat(1.5)
            app.buttons["Read · 2 min"].firstMatch.tap(); beat(1.5)
            app.buttons["Close the brief"].firstMatch.tap(); beat(1)
        }
        app.buttons["Settings"].tap(); beat(1.5)
        app.buttons["Home"].tap(); beat(3)
        let ask = app.staticTexts["Get a buzz when your brief is ready?"]
        XCTAssertTrue(ask.waitForExistence(timeout: 10), "the soft ask did not appear after two briefs")
        for _ in 0..<6 where !app.buttons["Not now"].isHittable { app.swipeUp(); beat(0.8) }
        shot("09-soft-ask")
        app.buttons["Not now"].tap(); beat(1.5)
        XCTAssertFalse(ask.exists, "still asking after Not now")
        assertNoSystemPrompt("after Not now")
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60))
        beat(5)
        XCTAssertFalse(app.staticTexts["Get a buzz when your brief is ready?"].exists, "asked again after Not now")
    }
}
