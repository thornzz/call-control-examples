import { SubmitHandler, useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import OutboundCampaign from "./outbound-campaign";
import Instructions from "./instructions";
import AppStatus from "./app-status";
import { getStatusFunc, stringifyError } from "../shared";
import { useEffect, useState } from "react";
import { APP_TYPE_CUSTOM_IVR } from "../constants";
import { Error, ButtonForms } from "cc-component-lib";

type Inputs = {
  wavSource: string;
  keyCommands: string[];
};

export default function CustomIvr() {
  const { data, refetch } = useQuery({
    queryFn: getStatusFunc(APP_TYPE_CUSTOM_IVR),
    queryKey: ["status", APP_TYPE_CUSTOM_IVR],
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Inputs>();

  useEffect(() => {
    if (data?.keymap) {
      setValue("keyCommands", data.keymap);
    }
  }, [data, setValue]);

  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const onSubmit: SubmitHandler<Inputs> = async (submitData) => {
    setServerError(undefined);
    const formData = new FormData();
    formData.append("wavSource", submitData.wavSource[0]);
    formData.append("keyCommands", JSON.stringify(submitData.keyCommands));
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SERVER_BASE}/api/setup/ivr`,
        {
          method: "POST",
          body: formData,
        }
      );
      const json = await response.json();
      if (json?.errorCode) {
        setServerError(stringifyError(json));
        return;
      }
      await refetch();
    } catch (err) {
      console.log(err);
    }
  };

  function renderFunction() {
    const content = [];
    for (let i = 0; i <= 9; i++) {
      content.push(
        <div key={i} className="flex flex-row gap-2">
          <label className="flex items-center" htmlFor={`dtmf${i}`}>
            {i}:{" "}
          </label>
          <input
            className="h-[36px] rounded p-1 text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none"
            id={`dtmf${i}`}
            {...register(`keyCommands.${i}` as "keyCommands")}
          />
        </div>
      );
    }
    return content;
  }
  return (
    <section className="flex flex-row gap-10">
      <div className="bg-white rounded px-8 mb-4 flex flex-col w-3/5">
        {serverError && <Error message={serverError} />}
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="-mx-3 md:flex mb-6">
            <div className="md:w-full px-3">
              <div className="flex flex-col">
                <label htmlFor="csvFile">Prompt File</label>
                <input
                  type="file"
                  id="datasource"
                  accept=".wav"
                  aria-describedby="file-helper"
                  className="w-full text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none file:cursor-pointer cursor-pointer file:border-0 file:py-2 file:px-4 file:mr-4 file:bg-gray-800 file:hover:bg-gray-700 file:text-white rounded"
                  {...register("wavSource", { required: "Required" })}
                />
                <p
                  id="helper-text-explanation"
                  className="text-sm mt-1 text-gray-500 dark:text-gray-400"
                >
                  Select .wav file of IVR prompt
                </p>
                {errors.wavSource && (
                  <p className="text-red-500 text-sm">
                    {errors.wavSource.message}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div>
            <label>DTMF Redirection Inputs</label>
          </div>
          <div className="-mx-3 md:flex mb-2 py-5 flex-wrap gap-2 w-full">
            {renderFunction()}
          </div>
          <ButtonForms
            type="submit"
            disabled={isSubmitting}
            isLoading={isSubmitting}
            label="Update Config"
          />
        </form>
        <OutboundCampaign appType={APP_TYPE_CUSTOM_IVR} />
      </div>
      <div className="flex gap-10 flex-col w-2/5">
        <Instructions
          text="This application implements IVR functionality. After you have connected your APP,
          you can specify configuration for your IVR. Prompt file will be streamed to each handled by IVR connection,
          you also may specify DTMF string routes for redirection purposes. Moreover, you are able to perform
          outgoing calls from Custom IVR. You may specify comma-separated phone numbers and run dialing campaign."
          appType="ivr"
        />
        <AppStatus appType={APP_TYPE_CUSTOM_IVR} />
      </div>
    </section>
  );
}
