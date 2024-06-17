import Koa from "koa";
import * as Router from "@koa/router";
import { container } from "tsyringe";
import { AppService } from "./services/App.service";
import { bodyParser } from "@koa/bodyparser";

export default function init(koa: Koa) {
  const router = new Router();
  const app = container.resolve<AppService>("AppService");

  router.post("/api/connect", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      await app.connectApplication(ctx.request.body, intId);
      ctx.res.statusCode = 202;
      ctx.body = {
        message: "Accepted",
      };
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  router.post("/api/disconnect", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      await app.disconnectApplication(intId);
      ctx.res.statusCode = 202;
      ctx.body = {
        message: "Accepted",
      };
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  router.post("/api/webhook/ivr", async (ctx, next) => {
    app.customIvrSvc.webHookEventEmitter(ctx.request.body);
    ctx.res.statusCode = 202;
    ctx.body = {
      message: "Accepted",
    };
    await next();
  });

  router.post("/api/webhook/dialer", async (ctx, next) => {
    app.dialerAppSvc.webHookEventEmitter(ctx.request.body);
    ctx.res.statusCode = 202;
    ctx.body = {
      message: "Accepted",
    };
    await next();
  });

  router.post("/api/setup/ivr", async (ctx, next) => {
    try {
      await app.LoadConfig(ctx.req);
      ctx.res.statusCode = 202;
      ctx.body = {
        message: "Accepted",
      };
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  router.get("/api/ivr/status", async (ctx, next) => {
    const status = app.customIvrSvc.status();
    ctx.res.statusCode = 200;
    ctx.body = status;
    await next();
  });

  router.get("/api/dialer/status", async (ctx, next) => {
    const status = app.dialerAppSvc.status();
    ctx.res.statusCode = 200;
    ctx.body = status;
    await next();
  });

  router.get("/api/dialer/status", async (ctx, next) => {
    const status = app.dialerAppSvc.status();
    ctx.res.statusCode = 200;
    ctx.body = status;
    await next();
  });

  router.post("/api/dialing", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      app.startDialing(ctx.request.body, intId);
      ctx.res.statusCode = 204;
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  router.post("/api/dropcall", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      app.dropCall(ctx.request.body, intId);
      ctx.res.statusCode = 204;
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  return router;
}
