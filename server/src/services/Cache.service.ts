import * as NodeCache from "node-cache";
import { autoInjectable, injectable, singleton } from "tsyringe";
import { ConnectAppRequest } from "../types";
import { AppType } from "../constants";

/**
 * Responsible for storing data in cache, like access_token
 */
@injectable()
@singleton()
export class CacheService {
  public cache = new NodeCache();
  private TTL_ACCESS_TOKEN = 1800;

  clearCache(appType: AppType) {
    this.cache.del(appType); // remove credentials
    this.cache.del(appType + "Token"); // remove token
  }

  setAppCredentials(config: ConnectAppRequest, key: AppType) {
    this.cache.set(key, config);
  }

  getAppBaseUrl(appType: AppType) {
    const appSett = this.cache.get<ConnectAppRequest>(appType);
    if (!appSett?.pbxBase) {
      throw Error(`BASE URL OF ${appType.toString()} is not defined`);
    }
    return appSett.pbxBase;
  }

  getAppAccessToken(appType: AppType) {
    const token = this.cache.get<string>(appType + "Token");
    return token;
  }

  setAppAccessToken(appType: AppType, token: string) {
    this.cache.set(appType + "Token", "Bearer " + token, this.TTL_ACCESS_TOKEN);
  }

  getAppId(appType: AppType) {
    const appSett = this.cache.get<ConnectAppRequest>(appType);
    if (!appSett?.appId) {
      throw Error(`APP_ID OF ${appType.toString()} is not defined`);
    }
    return appSett.appId;
  }

  getAppSecret(appType: AppType) {
    const appSett = this.cache.get<ConnectAppRequest>(appType);
    if (!appSett?.appSecret) {
      throw Error(`APP_SECRET OF ${appType.toString()} is not defined`);
    }
    return appSett.appSecret;
  }
}
