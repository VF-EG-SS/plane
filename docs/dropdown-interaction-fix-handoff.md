# Dropdown and combobox interaction fix: handoff

## Scope

Commit `732f6e6eb9` on `vcs-dev` fixed several Plane web menus and comboboxes. This document is for an agent extending that work to other dropdowns. The commit is the source of truth; inspect its diff before copying a pattern.

The reported symptoms were:

- A menu appeared only while the pointer was held down, or disappeared on release.
- Menu items appeared but clicks reached the work item card or link behind them, sometimes opening its details in a new tab.
- Some popovers appeared at a screen corner instead of next to their trigger.
- Select options inside a modal were visible but could not be selected.

The fix covered `CustomMenu`, `ComboDropDown`, `CustomSelect`, `CustomSearchSelect`, the work item state dropdown, and selected web combobox callers. It is **not** evidence that every menu in the repository is fixed.

## What changed and why

### 1. Let Headless UI own the menu's open state

In `packages/ui/src/dropdowns/custom-menu.tsx`, a local `isOpen` value previously controlled rendering while Headless UI's `Menu` also tracked whether it was open. The custom trigger click toggled the local value, competing with `Menu.Button`. This could show a menu during a press and close it on release.

`CustomMenu` now renders items from the `open` value supplied by `Menu`. `MenuStateSync` mirrors that value only for outside click and hover behavior and keeps Headless UI's `close()` function available. The trigger's optional callback runs on `onClickCapture`; the click that changes menu state remains with `Menu.Button`. Menu item clicks close through Headless UI and stop the surrounding work item link from receiving the click.

For another Headless UI menu, check whether component state and Headless UI state both control visibility. Use one authoritative open state. Do not stop the trigger click before Headless UI processes it.

### 2. Position the actual interactive options element

In `CustomMenu`, `CustomSelect`, and `CustomSearchSelect`, Popper's `ref`, `style`, and attributes now attach to `Menu.Items` or `Combobox.Options` itself. Previously, Popper positioned an inner `div` while Headless UI's outer options element remained elsewhere. That mismatch could leave the visible panel at a corner or give it the wrong hit area.

The options element is initially hidden until Popper has measured that same element (`popperState?.elements.popper === popperElement`). The main menu uses fixed positioning. Its submenu is portalled into the main menu's positioned options element and uses absolute positioning relative to that container. The work item state dropdown in `apps/web/core/components/dropdowns/state/base.tsx` also portals its options and positions the outer `Combobox.Options` element.

For another misplaced popover, inspect the DOM and compare the element passed to `usePopper` with the element receiving `styles.popper`, `attributes.popper`, and the pointer events. Keep the chosen Popper strategy consistent with the portal container and CSS position. Check alignment after opening, scrolling, and near viewport edges.

### 3. Keep nonmodal combobox options interactive

The affected web combobox option lists now set `modal={false}` on `Combobox.Options`. These are ordinary dropdowns, not modal overlays. This prevents Headless UI's modal behavior from interfering with pointer interaction outside the combobox's original DOM location, especially for portalled lists. The shared `CustomSelect` and `CustomSearchSelect` do the same.

Inside a dialog, the shared selects portal their options to the nearest `[data-plane-modal-panel]` or `[role='dialog']` instead of always using `document.body`. `ModalCore` marks its panel with `data-plane-modal-panel`. Their Popper strategy is `absolute` in a dialog and `fixed` otherwise. This keeps options inside the dialog's interaction and stacking context. In the invitation modal, the `CustomSearchSelect` display element changed from a nested `button` to a `div` because the select already supplies its own button.

When extending this pattern, inspect whether an options list is genuinely a nonmodal dropdown and where it is portalled. A high `z-index` alone cannot fix a panel that is outside a dialog's interaction boundary or whose hit area is misplaced. Avoid nesting interactive buttons.

### 4. Stop clicks from activating clickable work item containers

`packages/ui/src/dropdowns/combo-box.tsx` now prevents the default action and stops propagation at the `Combobox` root, while still invoking a caller's `onClick`. Its lazy trigger wrapper also handles the first pointer or focus interaction so `renderByDefault={false}` cannot send that first click to the parent card. `CustomMenu` stops propagation and default navigation at its root after Headless UI has handled the event. Menu item handlers also stop propagation and close the menu.

The web `useDropdown` hook and label dropdown no longer stop propagation at their trigger, because that happened too early for the Headless UI button. For other dropdowns embedded in a clickable card or link, trace the event path. Protect the parent navigation at the dropdown boundary while preserving the library's trigger and option handlers. Prefer valid DOM structure where possible; a nested button inside a link deserves a separate review.

## Where to look next

Start with remaining uses of `Combobox.Options`, `Menu.Items`, `Listbox.Options`, `createPortal`, and `usePopper` in `apps/web` and `packages/ui`. Search for panels where Popper styles or refs sit on a child of the Headless UI options element, where options are portalled to `document.body` from inside a dialog, and where both local state and Headless UI state toggle the same menu. Also inspect `packages/ui/src/dropdowns/context-menu/` separately; it has its own portal and submenu implementation.

Useful repository searches:

```sh
rg -n 'Combobox\.Options|Menu\.Items|Listbox\.Options' apps/web packages/ui/src
rg -n 'usePopper|createPortal|Portal|stopPropagation|preventDefault' apps/web/core/components/dropdowns packages/ui/src/dropdowns
```

For each candidate, reproduce a specific failure before changing it. Avoid bulk adding `modal={false}` or bulk changing Popper strategies: some menus are intentionally modal or live in different positioning contexts.

## Regression checks

The commit added Storybook examples in `packages/ui/src/dropdowns/custom-menu.stories.tsx` and `combo-box.stories.tsx`. They cover a menu and combobox inside a clickable work item link, a portalled submenu, and selects inside a modal. Use them as a starting point, then test the actual Plane screens:

1. On a project work item board, open a three-dot menu with a normal click. Release the pointer; the menu should stay open. Select a main item and a submenu item. Each action should occur once, with no work item tab opening.
2. Open a state or other property combobox on a work item. Its panel should align with the trigger. Search and select with the mouse and keyboard. The card behind it should not open.
3. In project member or invitation dialogs, open searchable and plain selects. Their options should accept clicks, update the selected value, and remain visually inside the dialog.
4. Repeat near viewport edges, after scrolling, and with an outside click or Escape. Check that the panel closes and focus remains usable.

The original fix was checked with the UI and web builds and browser interaction against the regression stories. Any newly changed component still needs its own screen-level verification. `pnpm --filter=@plane/ui storybook` starts Storybook on port 6006 in a normal development environment; on this Windows machine, `pnpm.cmd` may be needed when PowerShell blocks `pnpm.ps1`.
