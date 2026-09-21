import XCTest

/// First run on a brand-new account, in the native shell, on the devices App Review used.
/// Guideline 2.1(a) (2026-09-21): the reviewer connected a brokerage, tapped Continue and the button
/// stuck on "Finishing…" with no way out. Setup must now always have an exit; this walks it on both
/// the iPhone and the iPad (where an iPhone-only app runs in compatibility mode).
final class FirstRunUITests: XCTestCase {

    private var app: XCUIApplication!
    private func env(_ k: String) -> String { ProcessInfo.processInfo.environment[k] ?? "" }
    private func beat(_ s: TimeInterval = 1.2) { Thread.sleep(forTimeInterval: s) }

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
    }

    /// WKWebView inputs need focus before the app-level typeText lands (see AssetlyDemoUITests).
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

    func testFirstRunAlwaysHasAWayOut() throws {
        app.launch()
        beat(3)

        // the fixture account is reset to "never onboarded" by e2e/reset-firstrun.mjs before this runs
        XCTAssertTrue(app.buttons["Continue with Apple"].waitForExistence(timeout: 40), "sign-in screen")
        XCTAssertTrue(app.buttons["Use a password instead"].waitForExistence(timeout: 10))
        app.buttons["Use a password instead"].tap()
        beat()
        fill(app.textFields.firstMatch, env("FIRSTRUN_EMAIL"), "the email field")
        fill(app.secureTextFields.firstMatch, env("FIRSTRUN_PASSWORD"), "the password field")
        tapReturn()

        // setup: the quiz is skippable...
        let skipQuiz = app.buttons["Skip — use defaults"]
        XCTAssertTrue(skipQuiz.waitForExistence(timeout: 60), "the investor quiz did not appear")
        skipQuiz.tap()
        beat(2)

        // ...and the holdings step now offers an exit that does not need a brokerage or a ticker
        XCTAssertTrue(app.buttons["Connect your brokerage"].waitForExistence(timeout: 20), "holdings step")
        let skip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] 'Skip for now'")).firstMatch
        XCTAssertTrue(skip.waitForExistence(timeout: 10), "no way out of setup — this is the 2.1(a) bug")
        XCTAssertTrue(skip.isHittable, "the way out of setup is not reachable on this device")
        skip.tap()

        // and it lands in the app rather than back on setup
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "setup did not complete")
        beat(2)
        XCTAssertFalse(app.staticTexts["Set up Assetly"].exists, "still stuck on setup")
    }
}
