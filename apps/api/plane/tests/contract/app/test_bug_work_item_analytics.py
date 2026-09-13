# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Issue, IssueLabel, Label, Project, ProjectMember, State


@pytest.mark.contract
@pytest.mark.django_db
def test_bug_label_breakdown_only_counts_bug_work_items(session_client, workspace, create_user):
    project = Project.objects.create(
        name="Bug analytics",
        identifier="BUG",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    todo = State.objects.create(name="To Do", group="unstarted", project=project, workspace=workspace)
    done = State.objects.create(name="Done", group="completed", project=project, workspace=workspace)
    bug_label = Label.objects.create(name="Bug", project=project, workspace=workspace)
    feature_label = Label.objects.create(name="Feature", project=project, workspace=workspace)
    bug_issue = Issue.objects.create(
        name="Broken work item",
        project=project,
        workspace=workspace,
        state=todo,
        created_by=create_user,
    )
    feature_issue = Issue.objects.create(
        name="Working work item",
        project=project,
        workspace=workspace,
        state=done,
        created_by=create_user,
    )
    IssueLabel.objects.create(issue=bug_issue, label=bug_label, project=project, workspace=workspace)
    IssueLabel.objects.create(issue=feature_issue, label=feature_label, project=project, workspace=workspace)

    response = session_client.get(
        f"/api/workspaces/{workspace.slug}/advance-analytics-charts/"
        "?type=custom-work-items&x_axis=STATES&label_name=bug"
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data == {
        "data": [
            {
                "key": todo.id,
                "name": "To Do",
                "count": 1,
            }
        ],
        "schema": {},
    }
