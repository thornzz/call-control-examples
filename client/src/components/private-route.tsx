import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import CustomIvr from "./custom-ivr";
import Dialer from "./dialer";
import { getStatusFunc } from "../shared";

type ConnectFormProps = {
  appType: "ivr" | "dialer";
};
export default function PrivateRoute({ appType }: ConnectFormProps) {
  const { data } = useQuery({
    queryFn: getStatusFunc(appType),
    queryKey: [`status${appType}`],
  });
  return (
    <>
      {data?.connected === true ? (
        appType === "ivr" ? (
          <CustomIvr />
        ) : (
          appType === "dialer" && <Dialer appType="dialer" />
        )
      ) : (
        <Navigate replace to={`/${appType}/connect`} />
      )}
    </>
  );
}
