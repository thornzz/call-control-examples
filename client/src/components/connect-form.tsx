import { useQuery } from "@tanstack/react-query";
import { SubmitHandler, useForm } from "react-hook-form";
import { Navigate } from "react-router-dom";
import { getStatusFunc } from "../shared";
import { useState } from "react";
import Error from "./error";

type ConnectFormProps = {
  appType: "ivr" | "dialer";
};

type Inputs = {
  pbxBase: string;
  appId: string;
  appSecret: string;
};

export default function ConnectForm({ appType }: ConnectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Inputs>();
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const { data, refetch } = useQuery({
    queryFn: getStatusFunc(appType),
    queryKey: [`status${appType}`],
  });

  const onSubmit: SubmitHandler<Inputs> = async (submitData) => {
    setServerError(undefined);
    const enumeredType =
      appType === "ivr" ? "0" : appType === "dialer" ? "1" : undefined;
    if (enumeredType === undefined) {
      return;
    }
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER_BASE}/api/connect?appId=${enumeredType}`,
        {
          method: "POST",
          body: JSON.stringify({
            pbxBase: submitData.pbxBase,
            appId: submitData.appId,
            appSecret: submitData.appSecret,
          }),
          headers: {
            "Content-type": "application/json",
          },
        }
      );
      const json = await response.json();
      if (json?.errorMessage) {
        setServerError(json.errorMessage);
        return;
      }
      await refetch();
    } catch (err) {
      setServerError("Failed to connect to Application server");
    }
  };

  return (
    <>
      {data?.connected === true ? (
        <Navigate replace to={`/${appType}`} />
      ) : (
        <div className="flex flex-col gap-3 items-center">
          {serverError && <Error message={serverError} />}
          <form
            className="flex flex-col gap-3 w-1/2"
            onSubmit={handleSubmit(onSubmit)}
          >
            <label htmlFor="pbxBase">PBX Base URL</label>
            <input
              className="w-full h-[36px] rounded p-1 text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none"
              placeholder="https://pbx.3cx.com"
              id="pbxBase"
              {...register("pbxBase", { required: "Required" })}
            />
            {errors.pbxBase && (
              <p className="text-red-500 text-sm">{errors.pbxBase.message}</p>
            )}
            <label htmlFor="appId">APP ID</label>
            <input
              className="w-full h-[36px] rounded p-1 text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none"
              id="appId"
              placeholder="APP2JAdaOIWKdasG23KAL"
              {...register("appId", { required: "Required" })}
            />
            {errors.appId && (
              <p className="text-red-500 text-sm">{errors.appId.message}</p>
            )}
            <label htmlFor="appSecret">APP Secret</label>
            <input
              className="w-full h-[36px] rounded p-1 text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none"
              placeholder="APPSEC3123klJKSADjasdk"
              id="appSecret"
              {...register("appSecret", { required: "Required" })}
            />
            {errors.appSecret && (
              <p className="text-red-500 text-sm">{errors.appSecret.message}</p>
            )}
            <button
              disabled={isSubmitting}
              type="submit"
              className="rounded w-1/4 h-[45px] mt-3 bg-gray-800 hover:bg-gray-700 text-white disabled:bg-gray-200 disabled:text-gray-500"
            >
              Connect
            </button>
          </form>
        </div>
      )}
    </>
  );
}
