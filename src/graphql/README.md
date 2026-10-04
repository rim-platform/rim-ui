# GraphQL Documents

- Put shared fragments in `fragments/`.
- Put queries in `queries/`.
- Put mutations in `mutations/`.
- Generated SDK output is written to `src/core/graphql/generated/sdk.ts`.
- The current local backend GraphQL POST endpoint responds on `http://localhost:8080/api`.
- Set `GRAPHQL_SCHEMA_URL` when running `npm run codegen` if the backend schema endpoint is not the default local URL.
