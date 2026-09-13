# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest import mock

import pytest
from rest_framework import status

from plane.db.models import FileAsset, Issue, Project, ProjectMember, State, User

FILE_SIZE_LIMIT = 209715200


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(
        name="Attachment Project",
        identifier="ATT",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        project=project,
        workspace=workspace,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def issue(db, workspace, project, create_user):
    state = State.objects.create(
        name="Todo",
        workspace=workspace,
        project=project,
        group="unstarted",
        default=True,
    )
    return Issue.objects.create(
        name="Attachment limits",
        workspace=workspace,
        project=project,
        state=state,
        created_by=create_user,
    )


@pytest.mark.contract
class TestPublicIssueAttachmentSize:
    @pytest.fixture(autouse=True)
    def file_size_limit(self, settings):
        settings.FILE_SIZE_LIMIT = FILE_SIZE_LIMIT

    def url(self, workspace, project, issue):
        return f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/work-items/{issue.id}/attachments/"

    @pytest.mark.django_db
    def test_exact_limit_is_presigned_without_clamping(self, api_key_client, workspace, project, issue):
        with mock.patch("plane.api.views.issue.S3Storage") as storage:
            storage.return_value.generate_presigned_post.return_value = {"url": "https://storage.example/upload"}
            response = api_key_client.post(
                self.url(workspace, project, issue),
                {"name": "release.mp4", "type": "video/mp4", "size": FILE_SIZE_LIMIT},
                format="json",
            )

        assert response.status_code == status.HTTP_200_OK
        asset = FileAsset.objects.get(id=response.data["asset_id"])
        assert asset.size == FILE_SIZE_LIMIT
        storage.return_value.generate_presigned_post.assert_called_once_with(
            object_name=asset.asset.name,
            file_type="video/mp4",
            file_size=FILE_SIZE_LIMIT,
        )

    @pytest.mark.django_db
    def test_above_limit_returns_413_without_creating_asset(self, api_key_client, workspace, project, issue):
        with mock.patch("plane.api.views.issue.S3Storage") as storage:
            response = api_key_client.post(
                self.url(workspace, project, issue),
                {"name": "release.mp4", "type": "video/mp4", "size": FILE_SIZE_LIMIT + 1},
                format="json",
            )

        assert response.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        assert response.data["error"] == "FILE_TOO_LARGE"
        assert response.data["max_size"] == FILE_SIZE_LIMIT
        assert not FileAsset.objects.filter(issue=issue).exists()
        storage.assert_not_called()

    @pytest.mark.django_db
    @pytest.mark.parametrize("size", [None, 0, -1, "1.5"])
    def test_invalid_size_returns_400_without_creating_asset(self, api_key_client, workspace, project, issue, size):
        response = api_key_client.post(
            self.url(workspace, project, issue),
            {"name": "release.mp4", "type": "video/mp4", "size": size},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "INVALID_FILE_SIZE"
        assert not FileAsset.objects.filter(issue=issue).exists()


@pytest.fixture
def upload_initiator(db):
    return User.objects.create(
        email="public-upload-initiator@example.com",
        username="public-upload-initiator",
    )


@pytest.fixture
def pending_attachment(workspace, project, issue, upload_initiator):
    attachment = FileAsset(
        attributes={"name": "release.pdf", "type": "application/pdf", "size": 1024},
        asset=f"{workspace.id}/release.pdf",
        size=1024,
        workspace=workspace,
        project=project,
        issue=issue,
        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
    )
    attachment.save(created_by_id=upload_initiator.id)
    return attachment


@pytest.mark.contract
class TestPublicIssueAttachmentConfirmation:
    def url(self, workspace, project, issue, attachment):
        return (
            f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}"
            f"/work-items/{issue.id}/attachments/{attachment.id}/"
        )

    @pytest.mark.django_db
    def test_matching_upload_is_confirmed_once_and_preserves_creator(
        self, api_key_client, workspace, project, issue, pending_attachment, upload_initiator
    ):
        metadata = {
            "ContentLength": 1024,
            "ContentType": "application/pdf",
            "ETag": '"etag"',
        }
        url = self.url(workspace, project, issue, pending_attachment)

        with (
            mock.patch("plane.utils.issue_attachment_upload.S3Storage") as storage,
            mock.patch("plane.api.views.issue.issue_activity") as activity,
        ):
            storage.return_value.get_object_metadata.return_value = metadata
            first_response = api_key_client.patch(url, {"is_uploaded": True}, format="json")
            second_response = api_key_client.patch(url, {"is_uploaded": True}, format="json")

        assert first_response.status_code == status.HTTP_204_NO_CONTENT
        assert second_response.status_code == status.HTTP_204_NO_CONTENT
        pending_attachment.refresh_from_db()
        assert pending_attachment.is_uploaded is True
        assert pending_attachment.storage_metadata == metadata
        assert pending_attachment.created_by_id == upload_initiator.id
        storage.return_value.get_object_metadata.assert_called_once_with(object_name=pending_attachment.asset.name)
        activity.delay.assert_called_once()

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        ("metadata", "error"),
        [
            (None, "UPLOAD_NOT_FOUND"),
            (
                {"ContentLength": 1025, "ContentType": "application/pdf"},
                "UPLOAD_METADATA_MISMATCH",
            ),
            (
                {"ContentLength": 1024, "ContentType": "image/png"},
                "UPLOAD_METADATA_MISMATCH",
            ),
        ],
    )
    def test_invalid_storage_metadata_leaves_upload_unconfirmed(
        self, api_key_client, workspace, project, issue, pending_attachment, metadata, error
    ):
        with (
            mock.patch("plane.utils.issue_attachment_upload.S3Storage") as storage,
            mock.patch("plane.api.views.issue.issue_activity") as activity,
        ):
            storage.return_value.get_object_metadata.return_value = metadata
            response = api_key_client.patch(
                self.url(workspace, project, issue, pending_attachment),
                {"is_uploaded": True},
                format="json",
            )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.data["error"] == error
        pending_attachment.refresh_from_db()
        assert pending_attachment.is_uploaded is False
        assert pending_attachment.storage_metadata == {}
        activity.delay.assert_not_called()

    @pytest.mark.django_db
    def test_cross_issue_and_project_ids_are_rejected_before_storage_access(
        self, api_key_client, workspace, project, issue, pending_attachment, create_user
    ):
        other_issue = Issue.objects.create(
            name="Other issue",
            workspace=workspace,
            project=project,
            state=issue.state,
            created_by=create_user,
        )
        other_project = Project.objects.create(
            name="Other project",
            identifier="OTH",
            workspace=workspace,
            created_by=create_user,
        )
        ProjectMember.objects.create(
            project=other_project,
            workspace=workspace,
            member=create_user,
            role=20,
            is_active=True,
        )
        other_state = State.objects.create(
            name="Todo",
            workspace=workspace,
            project=other_project,
            group="unstarted",
            default=True,
        )
        other_project_issue = Issue.objects.create(
            name="Other project issue",
            workspace=workspace,
            project=other_project,
            state=other_state,
            created_by=create_user,
        )

        with mock.patch("plane.utils.issue_attachment_upload.S3Storage") as storage:
            cross_issue_response = api_key_client.patch(
                self.url(workspace, project, other_issue, pending_attachment),
                {"is_uploaded": True},
                format="json",
            )
            cross_project_response = api_key_client.patch(
                self.url(workspace, other_project, other_project_issue, pending_attachment),
                {"is_uploaded": True},
                format="json",
            )

        assert cross_issue_response.status_code == status.HTTP_404_NOT_FOUND
        assert cross_project_response.status_code == status.HTTP_404_NOT_FOUND
        storage.assert_not_called()
        pending_attachment.refresh_from_db()
        assert pending_attachment.is_uploaded is False

    @pytest.mark.django_db
    def test_already_uploaded_attachment_does_not_access_storage_or_emit_activity(
        self, api_key_client, workspace, project, issue, pending_attachment
    ):
        pending_attachment.is_uploaded = True
        pending_attachment.storage_metadata = {
            "ContentLength": 1024,
            "ContentType": "application/pdf",
        }
        pending_attachment.save(update_fields=["is_uploaded", "storage_metadata"])

        with (
            mock.patch("plane.utils.issue_attachment_upload.S3Storage") as storage,
            mock.patch("plane.api.views.issue.issue_activity") as activity,
        ):
            response = api_key_client.patch(
                self.url(workspace, project, issue, pending_attachment),
                {"is_uploaded": True},
                format="json",
            )

        assert response.status_code == status.HTTP_204_NO_CONTENT
        storage.assert_not_called()
        activity.delay.assert_not_called()
