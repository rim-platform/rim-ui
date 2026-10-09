import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient, getCookie } from "../../../core/graphql/client";
import { getApiOrigin } from "../../../core/graphql/config";
import { ATTACHMENT_FIELDS } from "../../../graphql/fragments/message";

const CREATE_ATTACHMENT_MUTATION = gql`
  mutation CreateAttachment($input: CreateAttachmentInput!) {
    createAttachment(input: $input) {
      attachmentId
      uploadToken
      expiresAt
      maxSizeBytes
    }
  }
`;

const FINALIZE_ATTACHMENT_MUTATION = gql`
  mutation FinalizeAttachment($input: FinalizeAttachmentInput!) {
    finalizeAttachment(input: $input) {
      ...AttachmentFields
    }
  }
  ${ATTACHMENT_FIELDS}
`;

interface UploadTicket {
  attachmentId: string;
  uploadToken: string;
  expiresAt: string | null;
  maxSizeBytes: number | null;
}

interface CreateAttachmentVars {
  serverId: string;
  conversationId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  messageId?: string;
}

/** Ask for an upload ticket. `blobSha256` is required in an encrypted conversation. */
export function createAttachment(vars: CreateAttachmentVars & { blobSha256?: string }) {
  return graphqlClient.request<{ createAttachment: UploadTicket }>(CREATE_ATTACHMENT_MUTATION, {
    input: {
      serverId: vars.serverId,
      conversationId: vars.conversationId,
      filename: vars.filename,
      contentType: vars.contentType,
      sizeBytes: vars.sizeBytes,
      messageId: vars.messageId,
      ...(vars.blobSha256 ? { blobSha256: vars.blobSha256 } : {}),
    },
  });
}

export function useCreateAttachmentMutation() {
  return useMutation({ mutationFn: (vars: CreateAttachmentVars) => createAttachment(vars) });
}

interface FinalizeAttachmentVars {
  attachmentId: string;
  serverId: string;
}

export function finalizeAttachment(vars: FinalizeAttachmentVars) {
  return graphqlClient.request(FINALIZE_ATTACHMENT_MUTATION, {
    input: {
      attachmentId: vars.attachmentId,
      serverId: vars.serverId,
    },
  });
}

export function useFinalizeAttachmentMutation() {
  return useMutation({ mutationFn: (vars: FinalizeAttachmentVars) => finalizeAttachment(vars) });
}

const DELETE_ATTACHMENT_MUTATION = gql`
  mutation DeleteAttachment($input: DeleteAttachmentInput!) {
    deleteAttachment(input: $input)
  }
`;

interface DeleteAttachmentVars {
  attachmentId: string;
  serverId: string;
}

export function useDeleteAttachmentMutation() {
  return useMutation({
    mutationFn: (vars: DeleteAttachmentVars) =>
      graphqlClient.request<{ deleteAttachment: boolean }>(DELETE_ATTACHMENT_MUTATION, {
        input: {
          attachmentId: vars.attachmentId,
          serverId: vars.serverId,
        },
      }),
  });
}

const CSRF_COOKIE = "rim_csrf";
const CSRF_HEADER = "x-csrf-token";

/**
 * Upload a file to the REST endpoint using the upload token from createAttachment.
 */
export async function uploadFileRest(
  file: File,
  uploadToken: string,
  attachmentId: string,
): Promise<void> {
  const uploadUrl = getApiOrigin() + "/api/files/upload";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_token", uploadToken);
  formData.append("attachment_id", attachmentId);

  const headers: Record<string, string> = {};
  const csrf = getCookie(CSRF_COOKIE);
  if (csrf) headers[CSRF_HEADER] = csrf;

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
}
