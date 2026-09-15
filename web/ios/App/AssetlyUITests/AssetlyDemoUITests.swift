import XCTest

/// The App Review demo walkthrough, driven on a real iPhone. Xcode records the run automatically and
/// that recording is what gets attached to the Resolution Center reply. Beats, in Apple's order:
/// launch -> passwordless sign-in (registration) -> password sign-in (login) -> the product ->
/// account deletion, performed on a throwaway account so the demo account survives.
/// Credentials arrive as TEST_RUNNER_* environment variables; nothing secret lives in the repo.
final class AssetlyDemoUITests: XCTestCase {

    private var app: XCUIApplication!
    private func env(_ key: String) -> String { ProcessInfo.processInfo.environment[key] ?? "" }

    override func setUp() {
        continueAfterFailure = true                      // a missing beat should not truncate the recording
        // the target application, not a remote reference: a remote XCUIApplication cannot receive typed text
        app = XCUIApplication()
    }

    /// A reviewer watches this at normal speed, so every beat has to be readable.
    private func beat(_ seconds: TimeInterval = 1.8) { Thread.sleep(forTimeInterval: seconds) }

    private func note(_ text: String) { XCTContext.runActivity(named: text) { _ in } }

    /// WKWebView inputs do not reliably accept typeText on the element itself: tap to focus, wait for
    /// the keyboard, then type through the application.
    @discardableResult
    private func fill(_ field: XCUIElement, _ text: String, _ what: String) -> Bool {
        guard field.waitForExistence(timeout: 15) else { note("MISSING \(what)"); return false }
        field.tap()
        guard app.keyboards.element.waitForExistence(timeout: 8) else { note("no keyboard for \(what)"); return false }
        beat(0.6)
        app.typeText(text)
        beat(0.6)
        return true
    }

    private func tap(_ label: String, _ what: String? = nil, timeout: TimeInterval = 12) -> Bool {
        for query in [app.buttons, app.staticTexts, app.links] {
            let el = query[label]
            if el.waitForExistence(timeout: timeout / 3) {
                if el.isHittable { el.tap() } else { el.coordinate(withNormalizedOffset: .zero).tap() }
                return true
            }
        }
        note("could not tap \(what ?? label)")
        return false
    }

    /// Return submits the web form, so it is only ever pressed on the LAST field of a form.
    private func submitFromKeyboard() {
        for name in ["Return", "return", "go", "Go", "Done"] where app.keyboards.buttons[name].exists {
            app.keyboards.buttons[name].tap(); beat(0.8); return
        }
        note("no return key on the keyboard")
    }

    /// First button whose accessibility label starts with `prefix` (the brief's controls are labelled
    /// "Read · 2 min" and "Listen to your brief…", which change with the edition).
    private func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }

    /// Signs in through the visible email form with a password. No hidden gesture is involved.
    private func signIn(email: String, password: String) {
        _ = tap("Use a password instead", "the password disclosure", timeout: 20)
        beat()
        // tapping the next field moves focus without submitting; Return is saved for the last one
        _ = fill(app.textFields.firstMatch, email, "the email field")
        _ = fill(app.secureTextFields.firstMatch, password, "the password field")
        submitFromKeyboard()
    }

    func testDemoWalkthrough() throws {
        // --- 1. cold launch. Apple asks for the recording to start here.
        app.launch()
        beat(3)
        XCTAssertTrue(app.buttons["Continue with Apple"].waitForExistence(timeout: 30), "sign-in screen")
        beat(2.5)

        // --- 2. registration / passwordless sign-in: the app emails a one-time link.
        note("passwordless sign-in")
        _ = fill(app.textFields.firstMatch, env("DEMO_EMAIL"), "the email field")
        submitFromKeyboard()                             // the form's only field, so Return sends the link
        // Supabase's built-in SMTP is rate limited: if the link did not go out, the screen shows an
        // error and the recording is unusable. Fail the run rather than attach a video with a red box.
        let sent = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Link sent'")).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 15), "the sign-in link was not sent (rate limit?) — re-run")
        beat(5)

        // --- 3. login with the App Review demo account.
        note("password sign-in")
        app.terminate(); beat(1); app.launch(); beat(2.5)
        signIn(email: env("DEMO_EMAIL"), password: env("DEMO_PASSWORD"))

        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "signed in: the tab bar is up")
        beat(4)                                          // Home: net worth, day change, holdings

        // --- 4. the product.
        note("Home and the brief")
        app.swipeUp(); beat(2.5)
        app.swipeDown(); beat(2)
        let read = button(startingWith: "Read")
        if read.waitForExistence(timeout: 10) { read.tap() } else { note("no Read control on the brief card") }
        beat(4)
        app.swipeUp(); beat(3.5)
        app.swipeUp(); beat(3)
        let listen = button(startingWith: "Listen")
        if listen.waitForExistence(timeout: 6) {
            listen.tap(); beat(10)                       // narration plays; the mini player docks above the tabs
            let pause = button(startingWith: "Pause")
            if pause.exists { pause.tap(); beat(1.5) }
        } else { note("no Listen control on the brief card") }
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(2) }

        note("a position")
        let firstRow = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] '$'")).element(boundBy: 0)
        if firstRow.exists && firstRow.isHittable { firstRow.tap(); beat(4); app.swipeUp(); beat(3) }
        if app.buttons["Home"].exists { app.buttons["Home"].tap(); beat(1.5) }

        note("News and Ask")
        if app.buttons["News"].exists { app.buttons["News"].tap(); beat(4); app.swipeUp(); beat(2.5) }
        if app.buttons["Ask"].exists {
            app.buttons["Ask"].tap(); beat(2.5)
            if fill(app.textFields.firstMatch, "What is my biggest position?", "the Ask field") {
                if !tap("Send", "the Send button", timeout: 6) { submitFromKeyboard() }
                // wait for the answer itself, not a fixed pause: the "Thinking" bubble goes when it lands
                let thinking = app.otherElements["Thinking"]
                _ = thinking.waitForExistence(timeout: 8)
                let deadline = Date().addingTimeInterval(60)
                while thinking.exists && Date() < deadline { beat(1) }
                beat(6)                                  // let the reader actually read the answer
                app.swipeUp(); beat(3)
            }
        }

        note("Settings: notifications, legal, account")
        if app.buttons["Settings"].exists { app.buttons["Settings"].tap(); beat(3) }
        app.swipeUp(); beat(2.5)
        app.swipeUp(); beat(2.5)                         // legal card + the not-advice line
        _ = tap("Sign out", "sign out", timeout: 10)
        beat(3)

        // --- 5. account deletion, on a throwaway account (Guideline 5.1.1(v)).
        note("account deletion")
        XCTAssertTrue(app.buttons["Continue with Apple"].waitForExistence(timeout: 30), "back at sign-in")
        beat(2)
        signIn(email: env("THROWAWAY_EMAIL"), password: env("THROWAWAY_PASSWORD"))
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 60), "signed in on the throwaway")
        beat(3)
        app.buttons["Settings"].tap(); beat(2.5)
        app.swipeUp(); beat(2); app.swipeUp(); beat(2)
        _ = tap("Delete account", "the delete button", timeout: 15)
        beat(3)                                          // confirm sheet: "Everything goes…"
        if env("REHEARSAL") == "1" {
            // dry runs keep the throwaway account so the flow can be replayed
            note("rehearsal: backing out of the deletion")
            _ = tap("Keep my account", "keep", timeout: 10)
            beat(2)
            return
        }
        _ = tap("Delete everything", "the confirm button", timeout: 15)
        beat(6)
        XCTAssertTrue(app.buttons["Continue with Apple"].waitForExistence(timeout: 40), "signed out after deletion")
        beat(3)
    }
}
