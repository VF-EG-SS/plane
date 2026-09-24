/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Combobox } from "@headlessui/react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ComboDropDown } from "./combo-box";
import { CustomSearchSelect } from "./custom-search-select";
import { CustomSelect } from "./custom-select";
import { ModalCore } from "../modals/modal-core";

const meta: Meta = {
  title: "Components/Dropdowns/Interaction regression",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

function WorkItemLink() {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("Backlog");
  const [navigation, setNavigation] = useState("No navigation");

  return (
    <a href="/work-item" target="_blank" onClick={() => setNavigation("Work item opened")}>
      <ComboDropDown
        as="div"
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue);
          setIsOpen(false);
        }}
        button={
          <button type="button" onClick={() => setIsOpen((wasOpen) => !wasOpen)}>
            {value}
          </button>
        }
      >
        {isOpen && (
          <Combobox.Options modal={false} as="ul" static className="relative z-50 border bg-surface-1 p-2">
            <Combobox.Input placeholder="Search states" />
            <div>
              <Combobox.Option as="li" value="Backlog" className="cursor-pointer p-1">
                Backlog
              </Combobox.Option>
              <Combobox.Option as="li" value="Todo" className="cursor-pointer p-1">
                Todo
              </Combobox.Option>
            </div>
          </Combobox.Options>
        )}
      </ComboDropDown>
      <span data-testid="navigation">{navigation}</span>
    </a>
  );
}

function SelectsInDialog() {
  const [member, setMember] = useState("");
  const [role, setRole] = useState("Guest");

  return (
    <ModalCore isOpen handleClose={() => {}}>
      <div className="flex gap-3 p-6">
        <CustomSearchSelect
          value={member}
          onChange={setMember}
          options={[
            { value: "Alice", query: "Alice", content: "Alice" },
            { value: "Bob", query: "Bob", content: "Bob" },
          ]}
          customButton={<span>{member || "Select co-worker"}</span>}
        />
        <CustomSelect value={role} onChange={setRole} customButton={<span>{role}</span>}>
          <CustomSelect.Option value="Guest">Guest</CustomSelect.Option>
          <CustomSelect.Option value="Member">Member</CustomSelect.Option>
        </CustomSelect>
      </div>
    </ModalCore>
  );
}

export const InWorkItemLink: Story = {
  render: () => <WorkItemLink />,
};

export const InDialog: Story = {
  render: () => <SelectsInDialog />,
};
