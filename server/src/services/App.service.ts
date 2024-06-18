import { ConnectAppRequest, DialingSetup, DropRequest } from "../types";
import { AppType } from "../constants";
import * as busboy from "busboy";
import { inject, injectable, singleton } from "tsyringe";
import * as wav from "wav";
import Koa, { ExtendableContext } from "koa";
import { CustomIVRAppService } from "./CustomIVRAppExample/CustomIVRApp.service";
import { DialerAppService } from "./DialerExample/DialerApp.service";
import * as path from "path";

@injectable()
@singleton()
export class AppService {
  constructor(
    @inject(CustomIVRAppService) public customIvrSvc: CustomIVRAppService,
    @inject(DialerAppService) public dialerAppSvc: DialerAppService
  ) {}

  public async connectApplication(
    body: ConnectAppRequest,
    intId: AppType
  ): Promise<void> {
    if (intId === AppType.CustomIvr) {
      await this.customIvrSvc.connect(body, intId);
    } else if (intId === AppType.Campaign) {
      await this.dialerAppSvc.connect(body, intId);
    } else {
      throw new Error("Unknown application type");
    }
  }

  public async disconnectApplication(intId: AppType): Promise<void> {
    if (intId === AppType.CustomIvr) {
      await this.customIvrSvc.disconenct();
    } else if (intId === AppType.Campaign) {
      await this.dialerAppSvc.disconenct();
    } else {
      throw new Error("Unknown application type");
    }
  }

  public async LoadConfig(req: ExtendableContext["req"]): Promise<void> {
    return new Promise((res, rej) => {
      const bb = busboy({ headers: req.headers });
      const config: Record<string, any> = {};
      bb.on("file", (fieldName, file, info) => {
        const { filename, mimeType } = info;
        if (mimeType === "audio/wav") {
          config.wavSource = filename;
          const pathToFile = path.resolve(__dirname, "../../", "public");
          const outputWriter = new wav.FileWriter(
            path.join(pathToFile, "output.wav"),
            {
              sampleRate: 8000,
              channels: 1,
            }
          );
          file.pipe(outputWriter);
        }
      });
      bb.on("field", (name, val, info) => {
        try {
          config[name] = JSON.parse(val);
        } catch (e) {
          config[name] = val;
        }
      });
      bb.on("close", async () => {
        try {
          this.customIvrSvc.setup(config);
          res();
        } catch (err) {
          rej(new Error("Failed to parse Config"));
        }
      });
      bb.on("error", () => rej(new Error("Form upload failed")));
      req.pipe(bb);
    });
  }

  public async dropCall(body: DropRequest, intId: AppType): Promise<void> {
    if (intId === AppType.Campaign) {
      this.dialerAppSvc.dropCall(body.participantId);
    } else if (intId === AppType.CustomIvr) {
      this.customIvrSvc.dropCall(body.participantId);
    } else {
      throw new Error("Failed to drop call: Unknown Application Type");
    }
  }

  public async startDialing(
    dialingSetup: DialingSetup,
    intId: AppType
  ): Promise<void> {
    if (intId === AppType.Campaign) {
      this.dialerAppSvc.startDialing(dialingSetup);
    } else if (intId === AppType.CustomIvr) {
      this.customIvrSvc.startDialing(dialingSetup);
    } else {
      throw new Error("Failed to start Dialing: Unknown Application Type");
    }
  }
}
