import { useMemo, useCallback } from "react";

import {
  FromNumberTooltip,
  FromNumberToggleButton,
  FromNumberButton,
} from "./Components";
import { CaretDownSvg } from "./Icons";
import { getFormattedFromNumber } from "../utils/phoneNumberUtils";
import { useQuery } from "@tanstack/react-query";
import { getStatusFunc } from "../utils";

/**
 * In HubSpot example there is phone number selection
 * In Case of 3cx Intagration we changed this select to Device Select,
 * Because you should be already logged in with your PBX credentials and Source Calling Route Point
 * @param param0
 * @returns
 */
function FromDeviceDropdown({
  fromNumber,
  setFromNumber,
  setToggleFromNumbers,
  toggleFromNumbers,
  onSelect,
}: {
  fromNumber: string;
  setFromNumber: Function;
  setToggleFromNumbers: Function;
  toggleFromNumbers: boolean;
  onSelect?: (id: string) => void;
}) {
  const { data } = useQuery({
    queryFn: getStatusFunc(),
    queryKey: ["status", "dialer"],
  });

  const handleFromDevice = useCallback(
    (deviceId: string) => {
      setFromNumber(deviceId);
      setToggleFromNumbers(false);
    },
    [setFromNumber, setToggleFromNumbers]
  );

  const FromNumbers = useMemo(() => {
    return (
      <div>
        {data?.devices?.map((item) => (
          <div key={item.device_id}>
            <FromNumberButton
              aria-label="us-number"
              onClick={() => handleFromDevice(item.device_id!)}
            >
              <span style={{ fontWeight: 600 }}>{item.user_agent}</span>
            </FromNumberButton>
          </div>
        ))}
        {/* <div>
          <FromNumberButton
            aria-label="us-number"
            onClick={() => handleFromNumber(FROM_NUMBER_ONE)}
          >
            <span style={{ fontWeight: 600 }}>My US Number </span>
            <span>{getFormattedFromNumber(FROM_NUMBER_ONE)}</span>
          </FromNumberButton>
        </div>
        <div>
          <FromNumberButton
            aria-label="uk-number"
            onClick={() => handleFromNumber(FROM_NUMBER_TWO)}
          >
            <span style={{ fontWeight: 600 }}>My UK Number </span>
            <span>{getFormattedFromNumber(FROM_NUMBER_TWO)}</span>
          </FromNumberButton>
        </div> */}
      </div>
    );
  }, [handleFromDevice]);

  return (
    <>
      <span style={{ marginRight: "10px" }}>From number:</span>
      <FromNumberTooltip
        aria-label={`from-number-${toggleFromNumbers ? "open" : "close"}`}
        content={FromNumbers}
        open={toggleFromNumbers}
      >
        <FromNumberToggleButton
          aria-label="from-number"
          onClick={() => setToggleFromNumbers(!toggleFromNumbers)}
        >
          {getFormattedFromNumber(fromNumber)} {CaretDownSvg}
        </FromNumberToggleButton>
      </FromNumberTooltip>
    </>
  );
}

export default FromDeviceDropdown;
