import { http, HttpResponse } from "msw";

// Factory for creating GraphQL mock responses
export function mockGraphQLQuery(operationName: string, data: unknown) {
  return http.post("*/api", async ({ request }) => {
    const body = (await request.json()) as { operationName?: string };
    if (body.operationName === operationName) {
      return HttpResponse.json({ data });
    }
  });
}

export function mockGraphQLMutation(operationName: string, data: unknown) {
  return mockGraphQLQuery(operationName, data);
}
