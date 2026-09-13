/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import useSWR from "swr";
// plane imports
import { CHART_COLOR_PALETTES, ISSUE_PRIORITIES } from "@plane/constants";
import { buildWorkItemFilterExpressionFromConditions } from "@plane/shared-state";
import { PieChart } from "@plane/propel/charts/pie-chart";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import type { IChartResponse } from "@plane/types";
import { ChartXAxisProperty } from "@plane/types";
// plane web imports
import AnalyticsSectionWrapper from "@/components/analytics/analytics-section-wrapper";
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useLabel } from "@/hooks/store/use-label";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
import { AnalyticsService } from "@/services/analytics.service";
import { ChartLoader } from "../loaders";

type TBreakdownDatum = {
  key: string;
  name: string;
  count: number;
  filterValues: string[];
};

type TBreakdownChartProps = {
  bugLabelIds: string[];
  xAxis: ChartXAxisProperty.PRIORITY | ChartXAxisProperty.STATES;
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
  none: "#ced4da",
};

const analyticsService = new AnalyticsService();

const BugBreakdownChart = observer(function BugBreakdownChart(props: TBreakdownChartProps) {
  const { bugLabelIds, xAxis } = props;
  const router = useAppRouter();
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const workspaceSlug = params.workspaceSlug.toString();
  const { selectedDuration, selectedProjects, selectedCycle, selectedModule, isPeekView, isEpic } = useAnalytics();
  const { workspaceStates } = useProjectState();

  const { data: chartResponse, isLoading } = useSWR(
    `bug-breakdown-${xAxis}-${workspaceSlug}-${selectedDuration}-${selectedProjects}-${selectedCycle}-${selectedModule}-${isPeekView}-${isEpic}`,
    () =>
      analyticsService.getAdvanceAnalyticsCharts<IChartResponse>(
        workspaceSlug,
        "custom-work-items",
        {
          label_name: "bug",
          ...(selectedProjects.length > 0 ? { project_ids: selectedProjects.join(",") } : {}),
          ...(selectedCycle ? { cycle_id: selectedCycle } : {}),
          ...(selectedModule ? { module_id: selectedModule } : {}),
          ...(isEpic ? { epic: true } : {}),
          x_axis: xAxis,
        },
        isPeekView
      )
  );

  const chartData = useMemo(
    () => (chartResponse?.data ?? []) as Omit<TBreakdownDatum, "filterValues">[],
    [chartResponse]
  );

  const breakdownData = useMemo<TBreakdownDatum[]>(() => {
    if (xAxis === ChartXAxisProperty.PRIORITY) {
      return ISSUE_PRIORITIES.map((priority) => {
        const datum = chartData.find((item) => item.key === priority.key);
        return {
          key: priority.key,
          name: priority.title,
          count: datum?.count ?? 0,
          filterValues: [priority.key],
        };
      });
    }

    const visibleStates = (workspaceStates ?? []).filter(
      (state) => selectedProjects.length === 0 || selectedProjects.includes(state.project_id)
    );
    const chartDataByStateId = new Map(chartData.map((datum) => [datum.key, datum]));
    const groupedStates = new Map<string, TBreakdownDatum>();

    visibleStates.forEach((state) => {
      const current = groupedStates.get(state.name) ?? {
        key: state.name,
        name: state.name,
        count: 0,
        filterValues: [],
      };
      current.count += chartDataByStateId.get(state.id)?.count ?? 0;
      current.filterValues.push(state.id);
      groupedStates.set(state.name, current);
    });

    chartData.forEach((datum) => {
      if (visibleStates.some((state) => state.id === datum.key)) return;
      const current = groupedStates.get(datum.name) ?? {
        key: datum.name,
        name: datum.name,
        count: 0,
        filterValues: [],
      };
      current.count += datum.count;
      current.filterValues.push(datum.key);
      groupedStates.set(datum.name, current);
    });

    return Array.from(groupedStates.values());
  }, [chartData, selectedProjects, workspaceStates, xAxis]);

  const total = useMemo(() => breakdownData.reduce((sum, datum) => sum + datum.count, 0), [breakdownData]);
  const colors = CHART_COLOR_PALETTES[0]?.[resolvedTheme === "dark" ? "dark" : "light"] ?? [];
  const cells = useMemo(
    () =>
      breakdownData.map((datum, index) => ({
        key: datum.key,
        fill:
          xAxis === ChartXAxisProperty.PRIORITY
            ? (PRIORITY_COLORS[datum.key] ?? colors[index % colors.length])
            : (workspaceStates?.find((state) => state.name === datum.name)?.color ?? colors[index % colors.length]),
      })),
    [breakdownData, colors, workspaceStates, xAxis]
  );

  const handleBreakdownClick = useCallback(
    (datum: TBreakdownDatum) => {
      if (datum.count === 0 || bugLabelIds.length === 0) return;

      const conditions = [
        { property: "label_id" as const, operator: "in" as const, value: bugLabelIds },
        {
          property: xAxis === ChartXAxisProperty.STATES ? ("state_id" as const) : ("priority" as const),
          operator: "in" as const,
          value: datum.filterValues,
        },
        ...(selectedProjects.length > 0
          ? [{ property: "project_id" as const, operator: "in" as const, value: selectedProjects }]
          : []),
        ...(selectedCycle ? [{ property: "cycle_id" as const, operator: "in" as const, value: [selectedCycle] }] : []),
        ...(selectedModule
          ? [{ property: "module_id" as const, operator: "in" as const, value: [selectedModule] }]
          : []),
      ];
      const filters = buildWorkItemFilterExpressionFromConditions({ conditions });
      if (!filters) return;

      const searchParams = new URLSearchParams({ analytics_filters: JSON.stringify(filters) });
      router.push(`/${workspaceSlug}/workspace-views/all-issues?${searchParams.toString()}`);
    },
    [bugLabelIds, router, selectedCycle, selectedModule, selectedProjects, workspaceSlug, xAxis]
  );

  const title = xAxis === ChartXAxisProperty.STATES ? "Bug work items by state" : "Bug work items by priority";

  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-4">
      <h2 className="text-14 font-medium">{title}</h2>
      <p className="mt-1 text-12 text-tertiary">Select a slice or percentage to view those work items.</p>
      {isLoading ? (
        <ChartLoader />
      ) : total > 0 ? (
        <div className="mt-4 grid min-h-72 grid-cols-1 items-center gap-4 sm:grid-cols-2">
          <PieChart
            className="h-64 w-full"
            dataKey="count"
            data={breakdownData}
            cells={cells}
            innerRadius="52%"
            outerRadius="78%"
            paddingAngle={2}
            cornerRadius={3}
            showLabel
            customLabel={(count) => `${Math.round((Number(count) / total) * 100)}%`}
            tooltipLabel="Bug work items"
            onItemClick={(datum) => {
              const matchingDatum = breakdownData.find((item) => item.key === String(datum.key));
              if (matchingDatum) handleBreakdownClick(matchingDatum);
            }}
          />
          <div className="space-y-2">
            {breakdownData.map((datum, index) => {
              const percentage = Math.round((datum.count / total) * 100);
              return (
                <button
                  key={datum.key}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-12 hover:bg-layer-1-hover disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={datum.count === 0 || bugLabelIds.length === 0}
                  onClick={() => handleBreakdownClick(datum)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: cells[index]?.fill }}
                    />
                    <span className="truncate">{datum.name}</span>
                  </span>
                  <span className="flex-shrink-0 text-secondary">
                    {datum.count} ({percentage}%)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyStateCompact
          assetKey="priority"
          assetClassName="size-16"
          rootClassName="mt-4 border border-subtle px-4 py-10"
          title="No work items with the Bug label yet"
        />
      )}
    </div>
  );
});

export const BugWorkItemsBreakdown = observer(function BugWorkItemsBreakdown() {
  const { workspaceSlug } = useParams();
  const { workspaceLabels } = useLabel();

  useWorkspaceIssueProperties(workspaceSlug);

  const bugLabelIds = useMemo(
    () => workspaceLabels?.filter((label) => label.name.trim().toLowerCase() === "bug").map((label) => label.id) ?? [],
    [workspaceLabels]
  );

  return (
    <AnalyticsSectionWrapper title="Bug work item breakdown">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <BugBreakdownChart bugLabelIds={bugLabelIds} xAxis={ChartXAxisProperty.STATES} />
        <BugBreakdownChart bugLabelIds={bugLabelIds} xAxis={ChartXAxisProperty.PRIORITY} />
      </div>
    </AnalyticsSectionWrapper>
  );
});
