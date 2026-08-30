import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open editor</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Edit item"
        description="Change the item safely."
      >
        <input aria-label="Item name" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  afterEach(cleanup);
  it("labels, traps, dismisses, and restores focus", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open editor" });
    opener.focus();
    fireEvent.click(opener);
    expect(
      await screen.findByRole("dialog", { name: "Edit item" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Change the item safely.")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
