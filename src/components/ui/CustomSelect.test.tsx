import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomSelect } from "./CustomSelect";

describe("CustomSelect", () => {
  it("renders the selected label in the app-styled trigger", () => {
    render(
      <CustomSelect aria-label="Status" value="running">
        <option value="all">All</option>
        <option value="running">Running</option>
      </CustomSelect>,
    );

    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Running");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("reports changes from its keyboard-accessible menu", async () => {
    const onChange = vi.fn();
    render(
      <CustomSelect aria-label="Change status" onChange={onChange} value="all">
        <option value="all">All</option>
        <option value="running">Running</option>
      </CustomSelect>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Change status" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Running" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "running" } }),
    );
  });
});
