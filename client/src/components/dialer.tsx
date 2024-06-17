import { SubmitHandler, useForm } from "react-hook-form";
import AppStatus from "./app-status";
import { useState } from "react";
import Error from "./error";
import Instructions from "./instructions";

type Inputs = {
  sources: string;
};
type ConnectFormProps = {
  appType: "ivr" | "dialer";
};
export default function Dialer({ appType }: ConnectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Inputs>();
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const onSubmit: SubmitHandler<Inputs> = async (submitData) => {
    const enumeredType =
      appType === "ivr" ? "0" : appType === "dialer" ? "1" : undefined;
    if (enumeredType === undefined) {
      return;
    }
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER_BASE}/api/dialing?appId=${enumeredType}`,
        {
          method: "POST",
          body: JSON.stringify({
            sources: submitData.sources,
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
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <div
      className={`bg-white ${
        appType === "dialer" && "px-8"
      } pt-6 pb-8 mb-4 flex flex-row gap-10 my-2`}
    >
      <form
        className={`flex flex-col gap3 ${
          appType === "dialer" ? "w-1/2" : "w-full"
        }`}
        onSubmit={handleSubmit(onSubmit)}
      >
        {serverError && <Error message={serverError} />}
        <label>Call Destinations</label>
        <textarea
          {...register("sources", { required: "Required" })}
          className="w-full h-[176px] resize-none rounded p-1 text-gray-500 font-medium text-sm bg-gray-100 shadow appearance-none"
        ></textarea>
        <p
          id="helper-text-explanation"
          className="text-sm mt-1 text-gray-500 dark:text-gray-400"
        >
          Please specify destination numbers separated by «,»
        </p>
        {errors.sources && (
          <p className="text-red-500 text-sm">{errors.sources.message}</p>
        )}
        <button
          disabled={isSubmitting}
          type="submit"
          className="rounded w-1/4 h-[36px] mt-3 bg-gray-800 hover:bg-gray-700 text-white disabled:bg-gray-200 disabled:text-gray-500 transform active:scale-95 transition-transform"
        >
          Start Dialing
        </button>
      </form>
      {appType === "dialer" && (
        <div className="flex flex-col gap-5 w-1/2">
          <Instructions
            appType="dialer"
            text="This application represents simple Outbound Campaign, you may specify comma-separated phone numbers and run dialing campaign"
          />
          <AppStatus appType="dialer" />
        </div>
      )}
    </div>
  );
}
