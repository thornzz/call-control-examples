import { AppStatus } from "./types";

export const getStatusFunc = (locationPath: string) => {
  const getStatus = async () => {
    const response: Promise<AppStatus> = fetch(
      `${process.env.REACT_APP_SERVER_BASE}/api/${locationPath}/status`,
      {
        method: "GET",
      }
    )
      .then((res) => res.json())
      .catch((err) => console.log(err));
    return (await response) || null;
  };

  return getStatus;
};
