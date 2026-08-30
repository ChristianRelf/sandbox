import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette",()=>{
  beforeEach(()=>localStorage.clear());
  it("supports active-descendant keyboard navigation and Enter activation",()=>{
    const add=vi.fn();render(<CommandPalette open onClose={()=>{}} onAdd={add}/>);const input=screen.getByRole("combobox");expect(input).toHaveAttribute("aria-activedescendant");fireEvent.keyDown(input,{key:"End"});fireEvent.keyDown(input,{key:"Home"});fireEvent.keyDown(input,{key:"Enter"});expect(add).toHaveBeenCalledTimes(1);
  });
  it("explains and suppresses a second trigger",()=>{
    const add=vi.fn();render(<CommandPalette open onClose={()=>{}} onAdd={add} hasTrigger/>);const input=screen.getByRole("combobox");fireEvent.change(input,{target:{value:"Manual Trigger"}});expect(screen.getByText(/already has a trigger/i)).toBeInTheDocument();fireEvent.keyDown(input,{key:"Enter"});expect(add).not.toHaveBeenCalled();
  });
});
