import "./services/dependency-injection";
import Koa from "koa";
import { bodyParser } from "@koa/bodyparser";
import * as cors from "@koa/cors";
import initMainRouter from "./main.routing";
import initWebhookRouter from "./webhook.routing";
import { PassThrough } from "stream";
import sseMiddleware from "./sse.middleware";
require("dotenv").config();

const app = new Koa();
const port = process.env.SERVER_PORT;
const host = process.env.SERVER_HOST;
const mainRouter = initMainRouter(app);
const webhookRouter = initWebhookRouter(app);

app
  .use(cors())
  .use(bodyParser())
  .use(mainRouter.allowedMethods())
  .use(mainRouter.routes())
  .use(webhookRouter.allowedMethods())
  .use(webhookRouter.routes())
  .use(sseMiddleware);

const server = app.listen(Number(port), host, undefined, async () => {
  console.log(server.address());
});
