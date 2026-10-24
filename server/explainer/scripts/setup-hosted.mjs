import OpenAI from "openai";
import { provisionSkill } from "../src/hosted-assets.mjs";
if (!process.env.OPENAI_API_KEY)
  throw Error("OPENAI_API_KEY is required on the server");
const config = await provisionSkill(new OpenAI());
console.log(JSON.stringify({ status: "ready", ...config }, null, 2));
