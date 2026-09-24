/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CustomMenu } from "./custom-menu";

const meta: Meta<typeof CustomMenu> = {
  title: "Components/CustomMenu",
  component: CustomMenu,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof CustomMenu>;

function WorkItemLink({ portalled = false }: { portalled?: boolean }) {
  const [selection, setSelection] = useState("None");
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);

  return (
    <div>
      {portalled && <div ref={setPortalElement} />}
      <a href="/work-item" target="_blank" onClick={() => setSelection("Work item opened")}>
        <span>Work item</span>
        <CustomMenu ellipsis placement="bottom-end" closeOnSelect portalElement={portalElement}>
          <CustomMenu.MenuItem onClick={() => setSelection("Edit selected")}>Edit</CustomMenu.MenuItem>
          <CustomMenu.SubMenu trigger="More">
            <CustomMenu.MenuItem onClick={() => setSelection("Duplicate selected")}>Duplicate</CustomMenu.MenuItem>
          </CustomMenu.SubMenu>
        </CustomMenu>
        <span data-testid="selection">{selection}</span>
      </a>
    </div>
  );
}

export const InWorkItemLink: Story = {
  render: () => <WorkItemLink />,
};

export const PortalledInWorkItemLink: Story = {
  render: () => <WorkItemLink portalled />,
};
