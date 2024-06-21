import Koa from "koa";
import * as Router from "@koa/router";
import { container } from "tsyringe";
import { AppService } from "./services/App.service";

export default function initWebhookRouter(koa: Koa) {
  const router = new Router();
  const app = container.resolve<AppService>("AppService");

  router.post("/api/webhook/ivr", async (ctx, next) => {
    app.customIvrSvc.webHookEventHandler(ctx.request.body);
    ctx.res.statusCode = 202;
    ctx.body = {
      message: "Accepted",
    };
    await next();
  });

  router.post("/api/webhook/campaign", async (ctx, next) => {
    app.outboundCampaignSvc.webHookEventHandler(ctx.request.body);
    ctx.res.statusCode = 202;
    ctx.body = {
      message: "Accepted",
    };
    await next();
  });

  router.post("/api/webhook/dialer", async (ctx, next) => {
    app.dialerAppSvc.webHookEventHandler(ctx.request.body);
    ctx.res.statusCode = 202;
    ctx.body = {
      message: "Accepted",
    };
    await next();
  });

  return router;
}
