import XCTest

/// The LinkedIn hero clip. `testAseed` signs in so the take opens on a lived-in app; `testBhero` is
/// the footage. Both must run in ONE xcodebuild invocation — each invocation reinstalls the app and
/// would wipe the session the seed just established.
///
/// Motion is the whole job: scroll with a press-and-drag, never swipeUp(). A swipe is a flick that
/// blurs past the content; a drag at this speed reads like a thumb and keeps the text legible.
final class AssetlyHeroUITests: XCTestCase {

    private var app: XCUIApplication!
    private func env(_ k: String) -> String { ProcessInfo.processInfo.environment[k] ?? "" }
    private func beat(_ s: TimeInterval = 1.0) { Thread.sleep(forTimeInterval: s) }

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
    }

    private enum Dir { case up, down }
    private func scroll(_ dir: Dir, _ amount: CGFloat) {
        let fromY: CGFloat = dir == .up ? 0.72 : 0.30
        let toY = dir == .up ? fromY - amount : fromY + amount
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: fromY))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: toY))
        start.press(forDuration: 0.08, thenDragTo: end)
    }

    private func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }

    private func fill(_ field: XCUIElement, _ text: String) {
        guard field.waitForExistence(timeout: 15) else { return }
        field.tap()
        _ = app.keyboards.element.waitForExistence(timeout: 8)
        beat(0.5)
        app.typeText(text)
        beat(0.4)
    }

    // MARK: seed

    func testAseed() {
        app.launch()
        beat(3)
        if !app.buttons["Settings"].waitForExistence(timeout: 12) {          // not already signed in
            guard app.buttons["Use a password instead"].waitForExistence(timeout: 30) else {
                XCTFail("no sign-in screen"); return
            }
            app.buttons["Use a password instead"].tap()
            beat()
            fill(app.textFields.firstMatch, env("SHOWCASE_EMAIL"))
            fill(app.secureTextFields.firstMatch, env("SHOWCASE_PASSWORD"))
            for n in ["Return", "return", "go", "Go", "Done"] where app.keyboards.buttons[n].exists {
                app.keyboards.buttons[n].tap(); break
            }
            XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 90), "seed sign-in failed")
        }
        pickAppearance()
        beat(4)                                   // let the book and the brief land
    }

    /// Pins the appearance the take is recorded in. `simctl ui appearance` does reach the WKWebView,
    /// but only when it is set before the simulator finishes booting, so the app's own Appearance
    /// control is belt and braces: it writes the choice to localStorage and survives the relaunch
    /// between the seed and the take. Not finding the chip is not a failure — the system appearance
    /// has already done the job by then, and failing here would abort the seed and cost the take.
    private func pickAppearance() {
        let want = env("HERO_THEME").isEmpty ? "Light" : env("HERO_THEME")
        guard app.buttons["Settings"].exists else { return }
        app.buttons["Settings"].tap(); beat(2.0)
        let chip = app.buttons[want]
        if chip.waitForExistence(timeout: 10) && chip.isHittable { chip.tap(); beat(1.2) }
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(1.4) }
    }

    // MARK: the take

    func testBhero() {
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "not signed in for the take")
        beat(3.5)                                 // BEAT 1 — net worth, day change

        scroll(.up, 0.26); beat(1.6)              // the book
        scroll(.up, 0.22); beat(1.4)
        scroll(.down, 0.40); beat(1.6)            // back to the top, brief card in view

        // BEAT 2 — the brief
        let read = button(startingWith: "Read")
        if read.waitForExistence(timeout: 10) { read.tap() }
        beat(2.4)
        scroll(.up, 0.26); beat(1.8)
        scroll(.up, 0.24); beat(1.8)

        // BEAT 3 — narration
        let listen = button(startingWith: "Listen")
        if listen.waitForExistence(timeout: 6) { listen.tap(); beat(4.0) }
        let pause = button(startingWith: "Pause")
        if pause.exists { pause.tap(); beat(0.8) }

        // BEAT 4 — a position, its chart and its intelligence
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(1.4) }
        let close = button(startingWith: "Close the brief")
        if close.exists { close.tap(); beat(1.0) }
        scroll(.up, 0.30); beat(1.0)
        let position = app.buttons.matching(NSPredicate(format: "label CONTAINS 'NVDA'")).firstMatch
        if position.waitForExistence(timeout: 8) { position.tap(); beat(3.0) }
        scroll(.up, 0.26); beat(2.4)
        scroll(.up, 0.22); beat(2.0)

        // BEAT 5 — the news that moved the book
        if app.buttons["News"].exists { app.buttons["News"].tap(); beat(2.6) }
        scroll(.up, 0.24); beat(2.0)

        // BEAT 6 — Ask. Close the narration player first so the answer has the screen to itself.
        let closePlayer = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Close the player' OR label CONTAINS[c] 'Close player'")).firstMatch
        if closePlayer.exists { closePlayer.tap(); beat(0.6) }
        if app.buttons["Ask"].exists { app.buttons["Ask"].tap(); beat(2.0) }
        let suggestion = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'biggest position'")).firstMatch
        if suggestion.waitForExistence(timeout: 6) {
            suggestion.tap()
        } else {
            fill(app.textFields.firstMatch, "What is my biggest position?")
            if app.buttons["Send"].exists { app.buttons["Send"].tap() }
        }
        // The first take ended on the typing indicator, so wait for the answer itself rather than a
        // fixed pause: it usually lands in about 5s once the function is warm.
        let answered = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'NVDA' OR label CONTAINS[c] 'biggest'")).element(boundBy: 1)
        _ = answered.waitForExistence(timeout: 40)
        beat(6.0)                                  // let it be read
        scroll(.up, 0.18); beat(3.0)
    }

    // MARK: the longer spots

    /// Footage for the 20s and 30s spots. Same beats as the hero take, then two more: Settings, and
    /// the appearance flipping to dark, which is the one moment in the app that reads as a visual
    /// event rather than a screen. The player is closed before Settings so the flip has the screen to
    /// itself, and the appearance is put back to Light at the end so the next take starts clean.
    func testCspot() {
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "not signed in for the take")
        beat(3.5)                                 // net worth

        scroll(.up, 0.26); beat(1.6)              // the book
        scroll(.up, 0.22); beat(1.4)
        scroll(.down, 0.40); beat(1.6)

        let read = button(startingWith: "Read")   // the brief
        if read.waitForExistence(timeout: 10) { read.tap() }
        beat(2.4)
        scroll(.up, 0.26); beat(1.8)
        scroll(.up, 0.24); beat(1.8)

        let listen = button(startingWith: "Listen")
        if listen.waitForExistence(timeout: 6) { listen.tap(); beat(4.0) }
        let pause = button(startingWith: "Pause")
        if pause.exists { pause.tap(); beat(0.8) }

        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(1.4) }
        let close = button(startingWith: "Close the brief")
        if close.exists { close.tap(); beat(1.0) }
        scroll(.up, 0.30); beat(1.0)
        let position = app.buttons.matching(NSPredicate(format: "label CONTAINS 'NVDA'")).firstMatch
        if position.waitForExistence(timeout: 8) { position.tap(); beat(3.0) }
        scroll(.up, 0.26); beat(2.4)
        scroll(.up, 0.22); beat(2.0)

        if app.buttons["News"].exists { app.buttons["News"].tap(); beat(2.6) }
        scroll(.up, 0.24); beat(2.0)

        let closePlayer = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Close the player' OR label CONTAINS[c] 'Close player'")).firstMatch
        if closePlayer.exists { closePlayer.tap(); beat(0.6) }
        if app.buttons["Ask"].exists { app.buttons["Ask"].tap(); beat(2.0) }
        let suggestion = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'biggest position'")).firstMatch
        if suggestion.waitForExistence(timeout: 6) {
            suggestion.tap()
        } else {
            fill(app.textFields.firstMatch, "What is my biggest position?")
            if app.buttons["Send"].exists { app.buttons["Send"].tap() }
        }
        let answered = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'NVDA' OR label CONTAINS[c] 'biggest'")).element(boundBy: 1)
        _ = answered.waitForExistence(timeout: 40)
        beat(6.0)
        scroll(.up, 0.18); beat(2.5)

        // NEW: Settings, then the flip. The Dark chip is tapped with a pause on either side so the
        // cut can land on the frame the ground changes.
        if app.buttons["Settings"].exists { app.buttons["Settings"].tap(); beat(2.2) }
        let dark = app.buttons["Dark"]
        if dark.waitForExistence(timeout: 8) && dark.isHittable { dark.tap(); beat(2.6) }
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(3.0) }     // dark home, held
        scroll(.up, 0.20); beat(2.0)
        if app.buttons["Settings"].exists { app.buttons["Settings"].tap(); beat(1.6) }
        let light = app.buttons["Light"]
        if light.waitForExistence(timeout: 8) && light.isHittable { light.tap(); beat(1.5) }
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(2.0) }     // real taps keep the recorder rolling
    }

    /// Just the appearance flip, for the spot's "light or dark" beat. XCUITest reports the Appearance
    /// chips as not hittable (a <button> inside a role=group in the web view), so `tap()` on the
    /// element is silently skipped — which is why testCspot recorded a flip that never happened.
    /// Tapping the element's centre COORDINATE bypasses the hittability check and lands.
    func testDflip() {
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "not signed in")
        beat(2.0)
        app.buttons["Settings"].tap(); beat(2.5)
        // app.buttons["Dark"] found nothing at all here, so match on label across every element
        // type and print the hierarchy so the next failure is diagnosable from the log.
        let chip = { (name: String) -> XCUIElement in
            self.app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@ OR label BEGINSWITH[c] %@", name, name + ",")).firstMatch
        }
        let dark = chip("Dark")
        if !dark.waitForExistence(timeout: 10) {
            NSLog("HIERARCHY %@", app.debugDescription)
            XCTFail("no Dark chip"); return
        }
        dark.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        beat(3.0)                                              // the flip, held
        app.buttons["Home"].tap(); beat(3.5)                   // dark home
        scroll(.up, 0.22); beat(2.5)
        scroll(.down, 0.30); beat(2.0)
        app.buttons["Settings"].tap(); beat(2.0)
        chip("Light").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        beat(2.0)
        app.buttons["Home"].tap(); beat(2.0)
    }
}
