import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient, getCookie } from "../../../core/graphql/client";
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

export function useCreateAttachmentMutation() {
  return useMutation({
    mutationFn: (vars: CreateAttachmentVars) =>
      graphqlClient.request<{ createAttachment: UploadTicket }>(CREATE_ATTACHMENT_MUTATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          filename: vars.filename,
          contentType: vars.contentType,
          sizeBytes: vars.sizeBytes,
          messageId: vars.messageId,
        },
      }),
  });
}

interface FinalizeAttachmentVars {
  attachmentId: string;
  serverId: string;
}

export function useFinalizeAttachmentMutation() {
  return useMutation({
    mutationFn: (vars: FinalizeAttachmentVars) =>
      graphqlClient.request(FINALIZE_ATTACHMENT_MUTATION, {
        input: {
          attachmentId: vars.attachmentId,
          serverId: vars.serverId,
        },
      }),
  });
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
export async function uploadFileRest(file: File, uploadToken: string): Promise<void> {
  const baseUrl = import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api";
  const uploadUrl = baseUrl.replace(/\/api$/, "") + "/api/files/upload";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_token", uploadToken);

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
