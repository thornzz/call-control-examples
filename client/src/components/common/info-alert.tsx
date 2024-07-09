import { useState } from "react";
import { ConnectFormProps } from "../../types";

interface InfoAlertProps {
  appType: ConnectFormProps["appType"];
}

export const InfoAlert: React.FC<InfoAlertProps> = ({ appType }) => {
  const [tooltipShown, toggle] = useState(false);
  return (
    <div
      className="flex bg-blue-100 rounded-lg p-4 mb-4 text-sm text-blue-700 max-w-lg"
      role="alert"
    >
      <svg
        className="w-10 h-10 inline mr-3"
        fill="currentColor"
        viewBox="0 0 20 20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        ></path>
      </svg>
      <div>
        <span className="font-medium">Please Note: </span>
        <span>APPHOOK dn property for current application is </span>
        <div className="relative flex items-center pb-2">
          <button
            className="cursor-pointer text-blue-500"
            onMouseLeave={() => toggle(false)}
            onClick={() => {
              navigator.clipboard.writeText(
                import.meta.env.VITE_SERVER_BASE +
                  "/api" +
                  "/webhook" +
                  `/${appType}`
              );
              toggle(true);
            }}
          >
            {import.meta.env.VITE_SERVER_BASE +
              "/api" +
              "/webhook" +
              `/${appType}`}
          </button>
          <div className={`${!tooltipShown ? "hidden" : ""}`}>
            <div className="absolute right-4 bottom-1 flex items-center group-hover:flex">
              <span className="relative z-10 p-2 text-xs text-white leading-none whitespace-no-wrap bg-slate-600 shadow-lg">
                Copied to clipboard!
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
