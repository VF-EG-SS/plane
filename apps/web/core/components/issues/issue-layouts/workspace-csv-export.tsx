/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { DownloadOutline } from "@makeplane/propel/icons";
import { download, generateCsv, mkConfig } from "export-to-csv";
// plane imports
import { Button } from "@plane/propel/button";
import type { TIssue, TIssueMap } from "@plane/types";
// plane web imports
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useCycle } from "@/hooks/store/use-cycle";

type Props = {
  issueIds: string[];
  issueMap: TIssueMap;
  workspaceSlug: string;
};

const csvConfig = (workspaceSlug: string) =>
  mkConfig({
    fieldSeparator: ",",
    filename: `${workspaceSlug}-work-items`,
    decimalSeparator: ".",
    useKeysAsHeaders: true,
  });

export function WorkspaceIssuesCsvExport(props: Props) {
  const { issueIds, issueMap, workspaceSlug } = props;
  const { getLabelById } = useLabel();
  const { getUserDetails } = useMember();
  const { getModuleById } = useModule();
  const { getProjectById } = useProject();
  const { getStateById } = useProjectState();
  const { getCycleById } = useCycle();

  const issues = useMemo(
    () => issueIds.map((issueId) => issueMap[issueId]).filter(Boolean) as TIssue[],
    [issueIds, issueMap]
  );

  const handleExport = () => {
    const rows = issues.map((issue) => ({
      Identifier: `${getProjectById(issue.project_id)?.identifier ?? ""}-${issue.sequence_id ?? ""}`.replace(
        /^-|-$/g,
        ""
      ),
      Title: issue.name,
      Project: getProjectById(issue.project_id)?.name ?? "",
      State: getStateById(issue.state_id)?.name ?? "",
      Priority: issue.priority ?? "None",
      Assignees: (issue.assignee_ids ?? [])
        .map((assigneeId) => getUserDetails(assigneeId)?.display_name)
        .filter(Boolean)
        .join(", "),
      Labels: (issue.label_ids ?? [])
        .map((labelId) => getLabelById(labelId)?.name)
        .filter(Boolean)
        .join(", "),
      Modules: (issue.module_ids ?? [])
        .map((moduleId) => getModuleById(moduleId)?.name)
        .filter(Boolean)
        .join(", "),
      Cycle: issue.cycle_id ? (getCycleById(issue.cycle_id)?.name ?? "") : "",
      "Start date": issue.start_date ?? "",
      "Due date": issue.target_date ?? "",
      "Created at": issue.created_at ?? "",
    }));
    const csv = generateCsv(csvConfig(workspaceSlug))(rows);
    download(csvConfig(workspaceSlug))(csv);
  };

  return (
    <Button
      variant="secondary"
      className="py-1"
      prependIcon={<DownloadOutline className="size-3.5" />}
      disabled={issues.length === 0}
      onClick={handleExport}
    >
      Export CSV
    </Button>
  );
}
