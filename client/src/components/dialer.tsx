import { APP_TYPE_DIALER } from "../constants";
import Dialpad from "./dialpad";
import Instructions from "./instructions";

export default function Dialer() {
  return (
    <div className="pt-6 pb-8 mb-4 flex flex-row gap-10 my-2">
      <div className="flex w-1/2">
        <Dialpad />
      </div>
      <div className="flex flex-col gap-5 w-1/2">
        <Instructions
          appType={APP_TYPE_DIALER}
          text="This application represents simple Dialer, you may use it like physical phone device. You also free to choose which device from list you will select for call handling"
        />
      </div>
    </div>
  );
}
