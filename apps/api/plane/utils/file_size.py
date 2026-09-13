# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


class InvalidFileSize(ValueError):
    """Raised when an upload size is missing or is not a positive integer."""


class FileTooLarge(ValueError):
    """Raised when an upload size exceeds the configured byte limit."""


def validate_file_size(value, maximum):
    """Return a positive integer byte size that does not exceed ``maximum``."""
    if isinstance(value, bool):
        raise InvalidFileSize

    if isinstance(value, int):
        size = value
    elif isinstance(value, str) and value.isdecimal():
        size = int(value)
    else:
        raise InvalidFileSize

    if size < 1:
        raise InvalidFileSize

    if size > maximum:
        raise FileTooLarge

    return size
