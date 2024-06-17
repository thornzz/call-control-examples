import "./services/dependency-injection";
import Koa from "koa";
import { bodyParser } from "@koa/bodyparser";
import * as cors from "@koa/cors";
import init from "./main.routing";
require("dotenv").config();

const app = new Koa();
const port = process.env.SERVER_PORT;
const host = process.env.SERVER_HOST;
const router = init(app);
app
  .use(cors())
  .use(bodyParser())
  .use(router.allowedMethods())
  .use(router.routes());

const server = app.listen(Number(port), host, undefined, async () => {
  console.log(server.address());
});
