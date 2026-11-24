/**
 * @jest-environment jsdom
 */

import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "@/components/live-trade/modal";

function FocusHarness({
  version,
  onClose,
  closeDisabled = false,
}: {
  version: number;
  onClose: (version: number) => void;
  closeDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose(version);
          setOpen(false);
        }}
        title="Edit INFY"
        description="Independent trade plan"
        closeDisabled={closeDisabled}
      >
        <label>
          Notes
          <input />
        </label>
      </Modal>
    </>
  );
}

describe("Modal focus lifecycle", () => {
  test("keeps focus inside the dialog when the parent supplies a new close callback", () => {
    const onClose = jest.fn();
    const { rerender } = render(<FocusHarness version={0} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const notes = screen.getByLabelText("Notes");
    act(() => notes.focus());

    rerender(<FocusHarness version={1} onClose={onClose} />);
    rerender(<FocusHarness version={2} onClose={onClose} />);

    expect(document.activeElement).toBe(notes);
    expect(document.body.style.overflow).toBe("hidden");
  });

  test("uses the latest close callback and restores focus to the trigger", () => {
    const onClose = jest.fn();
    const { rerender } = render(<FocusHarness version={0} onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Open editor" });
    act(() => trigger.focus());

    fireEvent.click(trigger);
    rerender(<FocusHarness version={1} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  test("honours the latest pending state for Escape without moving focus", () => {
    const onClose = jest.fn();
    const { rerender } = render(<FocusHarness version={0} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const notes = screen.getByLabelText("Notes");
    act(() => notes.focus());
    rerender(<FocusHarness version={1} onClose={onClose} closeDisabled />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(notes);
  });
});
