import "dotenv/config";
import { z } from "zod";

// Validação de configuração no boot. Falha cedo e claro se algo faltar.
const schema = z.object({
  VR_SOURCE: z.enum(["mock", "http"]).default("mock"),
  VR_API_BASE_URL: z.string().url().optional(),
  VR_API_TOKEN: z.string().optional(),
  VR_CLIENT_ID: z.string().optional(),
  VR_CLIENT_SECRET: z.string().optional(),

  STORE_ID: z.string().default("001"),
  STORE_NAME: z.string().default("Loja"),

  SINK: z.enum(["console", "html", "sheets", "bigquery"]).default("console"),

  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  BQ_PROJECT_ID: z.string().optional(),
  BQ_DATASET: z.string().default("supermercado"),
  BQ_LOCATION: z.string().default("southamerica-east1"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuração inválida:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
