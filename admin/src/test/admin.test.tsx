// The admin app's page: refusal for non-admins, live counts, the lock-screen preview, test-first gating, and the
// typed broadcast count. The server rules themselves are tested in supabase/functions/_shared/admin_push_test.ts.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPushScreen } from "../AdminPush";

const recipients = [{ user_id: "22222222-2222-4222-8222-222222222222", email: "two@example.com", display_name: null, devices: 1, environments: ["production"], last_brief_at: null, last_push_at: null }];
const adminCall = () => vi.fn().mockImplementation(async (b: Record<string, unknown>) => {
  if (b.action === "whoami") return { status: 200, body: { ok: true, admin: true, email: "minjae.m.lee@gmail.com" } };
  if (b.action === "recipients") return { status: 200, body: { ok: true, recipients, count: 1 } };
  if (b.action === "history") return { status: 200, body: { ok: true, history: [] } };
  if (b.action === "test") return { status: 200, body: { ok: true, sent: 1, devices: 1, ...(b.dry_run ? { dry_run: true } : {}) } };
  if (b.action === "broadcast") return { status: 200, body: { ok: true, recipients: 1, sent: 1, failed: 0 } };
  return { status: 200, body: { ok: true, sent: 1, devices: 1 } };
});
const deny = () => vi.fn().mockResolvedValue({ status: 403, body: { ok: false, error: "forbidden" } });

describe("the admin page", () => {
  it("a non-admin sees a refusal and a way to sign out, never the form", async () => {
    const out = vi.fn();
    render(<AdminPushScreen call={deny()} onSignOut={out} />);
    await screen.findByTestId("admin-denied");
    expect(screen.queryByTestId("admin-title")).toBeNull();
    await userEvent.click(screen.getByTestId("admin-sign-out"));
    expect(out).toHaveBeenCalled();
  });
  it("live counts, a lock-screen preview, and sending to others unlocks only after a test of the same words", async () => {
    render(<AdminPushScreen call={adminCall()} onSignOut={() => {}} />);
    await userEvent.type(await screen.findByTestId("admin-title"), "Holiday");
    await userEvent.type(screen.getByTestId("admin-body"), "Closed Monday.");
    expect(screen.getByTestId("admin-title-count").textContent).toBe("7/60");
    expect(screen.getByTestId("admin-body-count").textContent).toBe("14/178");
    expect(within(screen.getByTestId("admin-preview")).getByText("Holiday")).toBeTruthy();
    expect((screen.getByTestId("admin-broadcast") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId("admin-send-test"));
    await screen.findByText(/Sent to your 1 device/);
    expect((screen.getByTestId("admin-broadcast") as HTMLButtonElement).disabled).toBe(false);
    await userEvent.type(screen.getByTestId("admin-body"), "!");
    expect((screen.getByTestId("admin-broadcast") as HTMLButtonElement).disabled).toBe(true);
  });
  it("over the limit: the count turns red and nothing can be sent", async () => {
    render(<AdminPushScreen call={adminCall()} onSignOut={() => {}} />);
    await userEvent.type(await screen.findByTestId("admin-title"), "x".repeat(61));
    await userEvent.type(screen.getByTestId("admin-body"), "b");
    expect(screen.getByTestId("admin-title-count").className).toContain("over");
    expect((screen.getByTestId("admin-send-test") as HTMLButtonElement).disabled).toBe(true);
  });
  it("broadcast needs the recipient count typed", async () => {
    const call = adminCall();
    render(<AdminPushScreen call={call} onSignOut={() => {}} />);
    await userEvent.type(await screen.findByTestId("admin-title"), "Hi");
    await userEvent.type(screen.getByTestId("admin-body"), "There");
    await userEvent.click(screen.getByTestId("admin-send-test"));
    await screen.findByText(/Sent to your/);
    await userEvent.click(screen.getByTestId("admin-broadcast"));
    const go = screen.getByTestId("admin-confirm-broadcast") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await userEvent.type(screen.getByTestId("admin-confirm-count"), "2");
    expect(go.disabled).toBe(true);
    await userEvent.clear(screen.getByTestId("admin-confirm-count"));
    await userEvent.type(screen.getByTestId("admin-confirm-count"), "1");
    await userEvent.click(go);
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ action: "broadcast", confirm_count: 1, title: "Hi", body: "There" })));
  });
});
