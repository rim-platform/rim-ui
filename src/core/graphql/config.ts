export function getGraphqlEndpoint(): string {
  return import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api";
}
