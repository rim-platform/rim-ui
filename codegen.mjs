const schema = process.env.GRAPHQL_SCHEMA_URL || "schema.json";

/** @type {import('@graphql-codegen/cli').CodegenConfig} */
const config = {
  overwrite: true,
  schema,
  documents: ["src/graphql/**/*.graphql"],
  ignoreNoDocuments: true,
  generates: {
    "src/core/graphql/generated/sdk.ts": {
      plugins: ["typescript", "typescript-operations", "typescript-graphql-request"],
      config: {
        rawRequest: false,
        skipTypename: false,
      },
    },
  },
};

export default config;
