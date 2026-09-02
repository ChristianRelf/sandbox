import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

type SelectOption = {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
  group?: string;
};

export type CustomSelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

export type CustomSelectProps = {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: CustomSelectChangeEvent) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map(nodeText).join("").trim();
}

function collectOptions(children: ReactNode, group?: string): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{
      children?: ReactNode;
      value?: string | number;
      disabled?: boolean;
      label?: string;
    }>;
    if (element.type === Fragment) {
      options.push(...collectOptions(element.props.children, group));
      return;
    }
    if (element.type === "optgroup") {
      options.push(
        ...collectOptions(
          element.props.children,
          element.props.label ?? group,
        ),
      );
      return;
    }
    if (element.type !== "option") return;
    const text = nodeText(element.props.children);
    options.push({
      value: String(element.props.value ?? text),
      label: element.props.children,
      text,
      disabled: Boolean(element.props.disabled),
      group,
    });
  });
  return options;
}

export function CustomSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled = false,
  autoFocus,
  className,
  id,
  name,
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: CustomSelectProps) {
  const options = collectOptions(children);
  const selectedValue = String(value ?? defaultValue ?? "");
  const selected = options.find((option) => option.value === selectedValue);
  const groups = options.reduce<string[]>((current, option) => {
    if (option.group && !current.includes(option.group)) current.push(option.group);
    return current;
  }, []);

  const items = (group?: string) =>
    options
      .filter((option) => option.group === group)
      .map((option) => (
        <DropdownMenu.RadioItem
          className="custom-select-option"
          disabled={option.disabled}
          key={`${group ?? "ungrouped"}:${option.value}`}
          value={option.value}
          textValue={option.text}
        >
          <DropdownMenu.ItemIndicator className="custom-select-check">
            <Check aria-hidden="true" size={12} />
          </DropdownMenu.ItemIndicator>
          <span>{option.label}</span>
        </DropdownMenu.RadioItem>
      ));

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-required={required || undefined}
          autoFocus={autoFocus}
          className={["custom-select", className].filter(Boolean).join(" ")}
          data-placeholder={!selected || selectedValue === "" ? "true" : undefined}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span>{selected?.label ?? "Select…"}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </DropdownMenu.Trigger>
      {name && <input name={name} type="hidden" value={selectedValue} />}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="custom-select-menu"
          collisionPadding={8}
          sideOffset={5}
        >
          <DropdownMenu.RadioGroup
            onValueChange={(next) => {
              const event = {
                target: { value: next },
                currentTarget: { value: next },
              };
              onChange?.(event);
            }}
            value={selectedValue}
          >
            {items(undefined)}
            {groups.map((group) => (
              <div className="custom-select-group" key={group}>
                <DropdownMenu.Label className="custom-select-group-label">
                  {group}
                </DropdownMenu.Label>
                {items(group)}
              </div>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
