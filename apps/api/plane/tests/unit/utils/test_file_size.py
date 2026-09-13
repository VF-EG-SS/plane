# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.utils.file_size import FileTooLarge, InvalidFileSize, validate_file_size


@pytest.mark.unit
class TestValidateFileSize:
    @pytest.mark.parametrize("value", [1, 209715199, 209715200, "209715200"])
    def test_accepts_positive_sizes_through_the_limit(self, value):
        assert validate_file_size(value, 209715200) == int(value)

    @pytest.mark.parametrize("value", [None, True, False, 0, -1, "", "-1", "1.5", 1.5, [], {}])
    def test_rejects_invalid_sizes(self, value):
        with pytest.raises(InvalidFileSize):
            validate_file_size(value, 209715200)

    def test_rejects_size_above_the_limit(self):
        with pytest.raises(FileTooLarge):
            validate_file_size(209715201, 209715200)
