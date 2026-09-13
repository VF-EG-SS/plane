# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Verification helpers for direct issue-attachment uploads."""

# Django imports
from django.db import transaction

# Module imports
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage


class UploadNotFound(Exception):
    """Raised when the declared attachment object does not exist in storage."""


class UploadMetadataMismatch(Exception):
    """Raised when an uploaded object does not match its declaration."""


def verify_issue_attachment_upload(
    *,
    attachment_id,
    workspace_slug,
    project_id,
    issue_id,
    request=None,
):
    """Verify and confirm an issue attachment.

    Returns the attachment and whether this call changed it to uploaded. The
    row lock makes the state transition idempotent for concurrent confirmations.
    """
    with transaction.atomic():
        attachment = FileAsset.objects.select_for_update().get(
            pk=attachment_id,
            workspace__slug=workspace_slug,
            project_id=project_id,
            issue_id=issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
        )

        if attachment.is_uploaded:
            return attachment, False

        storage = S3Storage(request=request)
        metadata = storage.get_object_metadata(object_name=attachment.asset.name)
        if metadata is None:
            raise UploadNotFound

        if metadata.get("ContentLength") != attachment.size or metadata.get("ContentType") != attachment.attributes.get(
            "type"
        ):
            raise UploadMetadataMismatch

        attachment.storage_metadata = metadata
        attachment.is_uploaded = True
        attachment.save(update_fields=["storage_metadata", "is_uploaded"])
        return attachment, True
