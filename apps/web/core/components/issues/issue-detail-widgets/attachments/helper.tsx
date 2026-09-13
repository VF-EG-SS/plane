/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { setPromiseToast, TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TAttachmentUploadStatus } from "@/store/issue/issue-details/attachment.store";

export type TAttachmentOperations = {
  create: (file: File) => Promise<void>;
  remove: (attachmentId: string) => Promise<void>;
};

export type TAttachmentSnapshot = {
  uploadStatus: TAttachmentUploadStatus[] | undefined;
};

export type TAttachmentHelpers = {
  operations: TAttachmentOperations;
  snapshot: TAttachmentSnapshot;
};

type TAttachmentUploadError = {
  detail?: string;
  error?: string;
  max_size?: number;
  response?: {
    data?: TAttachmentUploadError;
  };
};

export const getAttachmentUploadErrorMessage = (error: unknown): string => {
  const errorPayload = error as TAttachmentUploadError | undefined;
  const responsePayload = errorPayload?.response?.data ?? errorPayload;
  const retryMessage = "Uploads cannot resume. Select the file and retry from the beginning.";

  switch (responsePayload?.error) {
    case "INVALID_FILE_SIZE":
      return `The file size is invalid. ${retryMessage}`;
    case "FILE_TOO_LARGE": {
      const maxSize = responsePayload.max_size;
      const limitMessage = maxSize
        ? `The file exceeds the ${maxSize / 1024 / 1024} MiB limit.`
        : "The file is too large.";
      return `${limitMessage} Choose a smaller file and retry from the beginning.`;
    }
    case "UPLOAD_NOT_FOUND":
      return `The uploaded file could not be found in storage. ${retryMessage}`;
    case "UPLOAD_METADATA_MISMATCH":
      return `The uploaded file did not match its declared size or type. ${retryMessage}`;
    default:
      return `The attachment could not be uploaded. ${retryMessage}`;
  }
};

export const useAttachmentOperations = (
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  issueServiceType: TIssueServiceType = EIssueServiceType.ISSUES
): TAttachmentHelpers => {
  const {
    attachment: { createAttachment, removeAttachment, getAttachmentsUploadStatusByIssueId },
  } = useIssueDetail(issueServiceType);

  const attachmentOperations: TAttachmentOperations = useMemo(
    () => ({
      create: async (file) => {
        if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
        const attachmentUploadPromise = createAttachment(workspaceSlug, projectId, issueId, file);
        setPromiseToast(attachmentUploadPromise, {
          loading: "Uploading attachment...",
          success: {
            title: "Attachment uploaded",
            message: () => "The attachment has been successfully uploaded",
          },
          error: {
            title: "Attachment not uploaded",
            message: (error: unknown) => getAttachmentUploadErrorMessage(error),
          },
        });

        await attachmentUploadPromise;
      },
      remove: async (attachmentId) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await removeAttachment(workspaceSlug, projectId, issueId, attachmentId);
          setToast({
            message: "The attachment has been successfully removed",
            type: TOAST_TYPE.SUCCESS,
            title: "Attachment removed",
          });
        } catch (_error) {
          setToast({
            message: "The Attachment could not be removed",
            type: TOAST_TYPE.ERROR,
            title: "Attachment not removed",
          });
        }
      },
    }),
    [workspaceSlug, projectId, issueId, createAttachment, removeAttachment]
  );
  const attachmentsUploadStatus = getAttachmentsUploadStatusByIssueId(issueId);

  return {
    operations: attachmentOperations,
    snapshot: { uploadStatus: attachmentsUploadStatus },
  };
};
