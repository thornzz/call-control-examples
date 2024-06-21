import Koa from "koa";
import * as Router from "@koa/router";
import { container } from "tsyringe";
import { AppService } from "./services/App.service";

export default function initMainRouting(koa: Koa) {
  const router = new Router();
  const app = container.resolve<AppService>("AppService");

  /**
   * Shared endpoints
   */
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

  router.get("/api/status", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      const status = app.getAppStatus(intId);
      ctx.res.statusCode = 200;
      ctx.body = status;
      await next();
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
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

  router.post("/api/controlcall", async (ctx, next) => {
    const queryParam = ctx.query.appId;
    try {
      const intId = parseFloat(queryParam as string);
      const resp = await app.controlParticipant(ctx.request.body, intId);
      ctx.res.statusCode = 204;
      await next();
    } catch (err: any) {
      console.log(err);
      if (err?.message === "Bad Request") {
        ctx.status = 400;
      } else {
        ctx.status = 500;
      }
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  /**
   * Endpoints for specific application
   */

  router.post("/api/setup/ivr", async (ctx, next) => {
    try {
      await app.loadIVRconfig(ctx.req);
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

  router.post("/api/dialer/setdevice", async (ctx, next) => {
    try {
      const id = app.setDialerActiveDevice(ctx.request.body);
      ctx.res.statusCode = 202;
      ctx.body = {
        activeDeviceId: id,
        message: "Accepted",
      };
      await next();
    } catch (err: any) {
      console.log(err);
      ctx.status = 500;
      ctx.body = {
        errorMessage: err?.message || "Internal Server Error",
      };
    }
  });

  return router;
}
