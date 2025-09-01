import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// This config uses the OpenAI JS client pointed at Azure's baseURL
// and adds api-version + api-key headers required by Azure OpenAI.
export const azureClient = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/`,
  defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview" },
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY }
});