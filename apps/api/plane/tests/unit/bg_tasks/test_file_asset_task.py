# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from plane.bgtasks.file_asset_task import delete_unuploaded_file_asset
from plane.db.models import FileAsset


@pytest.fixture
def make_file_asset(db, workspace):
    def _make_file_asset(*, age, name="pending.pdf", is_uploaded=False):
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": "application/pdf", "size": 1024},
            asset=f"{workspace.id}/{name}",
            size=1024,
            workspace=workspace,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=is_uploaded,
        )
        FileAsset.all_objects.filter(pk=asset.pk).update(created_at=timezone.now() - age)
        asset.refresh_from_db()
        return asset

    return _make_file_asset


@pytest.mark.unit
@pytest.mark.django_db
class TestDeleteUnuploadedFileAsset:
    def test_deletes_storage_object_before_expired_asset_row(self, make_file_asset):
        expired = make_file_asset(age=timedelta(days=8))

        with mock.patch("plane.bgtasks.file_asset_task.S3Storage") as storage_class:
            storage = storage_class.return_value
            storage.delete_files.return_value = True
            storage.delete_files.side_effect = lambda object_names: (
                FileAsset.all_objects.filter(pk=expired.pk).exists()
            )

            delete_unuploaded_file_asset()

        storage.delete_files.assert_called_once_with([expired.asset.name])
        assert not FileAsset.all_objects.filter(pk=expired.pk).exists()

    def test_missing_storage_object_is_safe(self, make_file_asset):
        expired = make_file_asset(age=timedelta(days=8), name="already-absent.pdf")

        with mock.patch("plane.bgtasks.file_asset_task.S3Storage") as storage_class:
            # S3 delete is idempotent and reports success when the key is absent.
            storage_class.return_value.delete_files.return_value = True
            delete_unuploaded_file_asset()

        assert not FileAsset.all_objects.filter(pk=expired.pk).exists()

    def test_storage_failure_retains_row_and_is_logged(self, make_file_asset):
        expired = make_file_asset(age=timedelta(days=8))

        with (
            mock.patch("plane.bgtasks.file_asset_task.S3Storage") as storage_class,
            mock.patch("plane.bgtasks.file_asset_task.log_exception") as log_exception,
        ):
            storage_class.return_value.delete_files.return_value = False
            delete_unuploaded_file_asset()

        assert FileAsset.all_objects.filter(pk=expired.pk).exists()
        log_exception.assert_called_once()

    def test_repeat_execution_is_safe(self, make_file_asset):
        expired = make_file_asset(age=timedelta(days=8))

        with mock.patch("plane.bgtasks.file_asset_task.S3Storage") as storage_class:
            storage_class.return_value.delete_files.return_value = True
            delete_unuploaded_file_asset()
            delete_unuploaded_file_asset()

        storage_class.return_value.delete_files.assert_called_once_with([expired.asset.name])
        assert not FileAsset.all_objects.filter(pk=expired.pk).exists()

    def test_configured_cutoff_retains_newer_assets(self, make_file_asset, monkeypatch):
        monkeypatch.setenv("UNUPLOADED_ASSET_DELETE_DAYS", "1")
        expired = make_file_asset(age=timedelta(days=2), name="expired.pdf")
        recent = make_file_asset(age=timedelta(hours=12), name="recent.pdf")

        with mock.patch("plane.bgtasks.file_asset_task.S3Storage") as storage_class:
            storage_class.return_value.delete_files.return_value = True
            delete_unuploaded_file_asset()

        assert not FileAsset.all_objects.filter(pk=expired.pk).exists()
        assert FileAsset.all_objects.filter(pk=recent.pk).exists()
