# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
from datetime import timedelta

# Django imports
from django.db import transaction
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage
from plane.utils.exception_logger import log_exception


BATCH_SIZE = 500


class StorageDeletionError(Exception):
    """Raised when storage does not confirm deletion of an asset object."""


@shared_task
def delete_unuploaded_file_asset():
    """Delete expired unuploaded objects and their database rows."""
    cutoff = timezone.now() - timedelta(days=int(os.environ.get("UNUPLOADED_ASSET_DELETE_DAYS", "7")))

    try:
        storage = S3Storage()
    except Exception as error:
        log_exception(error)
        return

    asset_ids = (
        FileAsset.all_objects.filter(created_at__lt=cutoff, is_uploaded=False)
        .order_by("created_at", "id")
        .values_list("id", flat=True)
        .iterator(chunk_size=BATCH_SIZE)
    )

    for asset_id in asset_ids:
        try:
            with transaction.atomic():
                asset = FileAsset.all_objects.select_for_update().get(
                    pk=asset_id,
                    created_at__lt=cutoff,
                    is_uploaded=False,
                )

                if asset.asset.name and not storage.delete_files([asset.asset.name]):
                    raise StorageDeletionError(f"Failed to delete storage object for file asset {asset.id}")

                asset.delete(soft=False)
        except FileAsset.DoesNotExist:
            # Another task may already have removed or confirmed the asset.
            continue
        except Exception as error:
            # Retain the row so the next scheduled run can retry safely.
            log_exception(error)
