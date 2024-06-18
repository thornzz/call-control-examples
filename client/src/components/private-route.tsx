import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import CustomIvr from "./custom-ivr";
import Dialer from "./dialer";
import { getStatusFunc } from "../shared";
import { ConnectFormProps } from "../types";
import { APP_TYPE_CUSTOM_IVR, APP_TYPE_OUTBOUND_CAMPAIGN } from "../constants";

export default function PrivateRoute({ appType }: ConnectFormProps) {
  const { data } = useQuery({
    queryFn: getStatusFunc(appType),
    queryKey: [`status${appType}`],
  });
  return (
    <>
      {data?.connected === true ? (
        appType === APP_TYPE_CUSTOM_IVR ? (
          <CustomIvr />
        ) : (
          appType === APP_TYPE_OUTBOUND_CAMPAIGN && (
            <Dialer appType={APP_TYPE_OUTBOUND_CAMPAIGN} />
          )
        )
      ) : (
        <Navigate replace to={`/${appType}/connect`} />
      )}
    </>
  );
}
