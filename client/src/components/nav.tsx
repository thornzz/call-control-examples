import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getStatusFunc } from "../shared";

export default function Nav() {
  const navigate = useNavigate();
  const handleRowClick = (url: string) => {
    navigate(url);
  };
  const ivr = useQuery({
    queryFn: getStatusFunc("ivr"),
    queryKey: [`statusivr`],
  });
  const dialer = useQuery({
    queryFn: getStatusFunc("dialer"),
    queryKey: [`statusdialer`],
  });

  function renderStatus(connected?: boolean) {
    return (
      <>
        {connected === true ? (
          <span className="relative flex h-4 w-4 ml-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500"></span>
          </span>
        ) : (
          <span className="relative flex h-4 w-4 ml-4">
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
          </span>
        )}
      </>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full my-0 align-middle text-dark border-neutral-200">
        <thead className="align-bottom w-full">
          <tr className="font-semibold text-[0.95rem] text-secondary-dark">
            <th className="pb-3 text-start min-w-[175px]">Name</th>
            <th className="pb-3 text-start min-w-[200px]">Status</th>
            <th className="pb-3 text-start min-w-[80px]">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr
            className="border-b border-dashed last:border-b-0 cursor-pointer"
            onClick={() => handleRowClick("/ivr")}
          >
            <td className="p-3 pl-0 text-start min-w-[175px]">
              <div className="flex items-center">
                <div className="relative inline-block shrink-0 rounded-2xl me-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue-100 bg-blue-50">
                    <svg
                      className="w-6 h-6"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="#EFF6FF"
                      viewBox="0 0 512 512"
                    >
                      <path
                        fill=""
                        className="fa-primary"
                        d="M128 288c0-17.7 14.3-32 32-32h32c17.7 0 32 14.3 32 32v32c0 17.7-14.3 32-32 32v32c0 35.3-28.7 64-64 64s-64-28.7-64-64V368c0-26.5-21.5-48-48-48H0V288H16c44.2 0 80 35.8 80 80v16c0 17.7 14.3 32 32 32s32-14.3 32-32V352c-17.7 0-32-14.3-32-32V288zm192-32h64c17.7 0 32 14.3 32 32V416c0 17.7-14.3 32-32 32H320c-17.7 0-32-14.3-32-32V288c0-17.7 14.3-32 32-32z"
                      />
                      <path
                        fill="#306ccf"
                        className="fa-secondary"
                        d="M64 0C28.7 0 0 28.7 0 64V288H16c44.2 0 80 35.8 80 80v16c0 17.7 14.3 32 32 32s32-14.3 32-32V352c-17.7 0-32-14.3-32-32V288c0-17.7 14.3-32 32-32h32c17.7 0 32 14.3 32 32v32c0 17.7-14.3 32-32 32v32c0 35.3-28.7 64-64 64s-64-28.7-64-64V368c0-26.5-21.5-48-48-48H0V448c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V64c0-35.3-28.7-64-64-64H64zm48 64h96c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm192 0h96c8.8 0 16 7.2 16 16s-7.2 16-16 16H304c-8.8 0-16-7.2-16-16s7.2-16 16-16zM112 128h96c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm192 0h96c8.8 0 16 7.2 16 16s-7.2 16-16 16H304c-8.8 0-16-7.2-16-16s7.2-16 16-16zm16 128h64c17.7 0 32 14.3 32 32V416c0 17.7-14.3 32-32 32H320c-17.7 0-32-14.3-32-32V288c0-17.7 14.3-32 32-32z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="flex flex-col justify-start">
                  <span className="mb-1 font-semibold transition-colors duration-200 ease-in-out text-secondary-inverse hover:text-primary">
                    {" "}
                    Custom IVR{" "}
                  </span>
                </div>
              </div>
            </td>
            <td className="p-3 pl-0 text-start font-semibold">
              {renderStatus(ivr.data?.connected)}
            </td>
            <td className="p-3 pl-0 text-start font-semibold">
              Route Point which works like IVR
            </td>
          </tr>
          <tr
            className="border-b border-dashed last:border-b-0 cursor-pointer"
            onClick={() => handleRowClick("/dialer")}
          >
            <td className="p-3 pl-0 text-start min-w-[175px]">
              <div className="flex items-center">
                <div className="relative inline-block shrink-0 rounded-2xl me-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue-100 bg-blue-50">
                    <svg
                      className="w-6 h-6"
                      fill="#306ccf"
                      xmlns="http://www.w4.org/2000/svg"
                      viewBox="0 0 640 512"
                    >
                      <path
                        className="fa-primary"
                        d="M448 192H576V448H448V192zm-16-64c-26.5 0-48 21.5-48 48V464c0 26.5 21.5 48 48 48H592c26.5 0 48-21.5 48-48V176c0-26.5-21.5-48-48-48H432z"
                      />
                      <path
                        className="fa-secondary"
                        d="M128 0C92.7 0 64 28.7 64 64V288H19.2C8.6 288 0 296.6 0 307.2C0 349.6 34.4 384 76.8 384H352V288H128V64H448V96h64V64c0-35.3-28.7-64-64-64H128zM576 448V192H448V448H576z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="flex flex-col justify-start">
                  <span className="mb-1 font-semibold transition-colors duration-200 ease-in-out text-secondary-inverse hover:text-primary">
                    Outbound Campaign
                  </span>
                </div>
              </div>
            </td>
            <td className="p-3 pl-0 text-start font-semibold">
              {renderStatus(dialer.data?.connected)}
            </td>
            <td className="p-3 pl-0 text-start font-semibold">
              Automated dialing of the participant list
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
