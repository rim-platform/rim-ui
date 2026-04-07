// GraphQL Codegen Configuration
// Generates TypeScript types from the backend GraphQL schema.
//
// Usage:
//   1. Export schema:  curl -s http://localhost:8080/api/sdl > schema.graphql
//   2. Generate types: npm run codegen
//
// The generated types (enums, inputs, object types) replace hand-written
// GraphQL types across the codebase. Run codegen after any backend schema change.

const schema = process.env.GRAPHQL_SCHEMA_URL || "schema.graphql";

/** @type {import('@graphql-codegen/cli').CodegenConfig} */
const config = {
  overwrite: true,
  schema,
  // Schema-types-only generation — no document scanning needed.
  // This avoids validation errors from stale/mismatched frontend queries
  // while still generating all the types, enums, and input types from the schema.
  generates: {
    "src/core/graphql/generated/schema-types.ts": {
      plugins: ["typescript"],
      config: {
        skipTypename: true,
        scalars: {
          DateTime: "string",
          JSON: "unknown",
          ID: "string",
          Upload: "File",
        },
        enumsAsTypes: false,
        constEnums: false,
        // Keep enum values as-is from the schema (SCREAMING_SNAKE)
        namingConvention: {
          enumValues: "keep",
        },
      },
    },
  },
};

export default config;
