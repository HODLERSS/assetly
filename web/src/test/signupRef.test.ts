import { describe, it, expect, beforeEach } from "vitest";
import { captureRef } from "../lib/signupRef";

describe("captureRef (first-touch campaign tag)", () => {
  beforeEach(() => localStorage.clear());
  it("keeps a valid ?ref= tag, first one wins", () => {
    expect(captureRef("?ref=flyer-cafe")).toBe("flyer-cafe");
    captureRef("?ref=youtube");
    expect(localStorage.getItem("assetly.signup_ref")).toBe("flyer-cafe");
  });
  it("ignores missing or malformed tags", () => {
    expect(captureRef("")).toBeNull();
    expect(captureRef("?ref=<script>")).toBeNull();
    expect(localStorage.getItem("assetly.signup_ref")).toBeNull();
  });
});
