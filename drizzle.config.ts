import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATA_DIR ? `${process.env.DATA_DIR}/fyrdrop.db` : "./data/fyrdrop.db",
  },
});
