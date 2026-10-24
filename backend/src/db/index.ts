import { Pool } from "pg";
import env from "../config/index.js";

export const pool = new Pool({
  connectionString: env.DB_URL,
  user: env.POSTGRES_USER,
  host: env.POSTGRES_HOST,
  database: env.POSTGRES_DB,
  password: env.POSTGRES_PASSWORD,
  port: env.POSTGRES_PORT,
  ...(env.POSTGRES_SSL
    ? {
        ssl: {
          rejectUnauthorized: env.POSTGRES_SSL_REJECT_UNAUTHORIZED,
        },
      }
    : {}),
});

