import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import Nav from "./components/nav";
import ConnectForm from "./components/connect-form";
import PrivateRoute from "./components/private-route";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "/",
        element: <Nav />,
      },
      {
        path: "/ivr",
        element: <PrivateRoute appType="ivr" />,
      },
      {
        path: "/dialer",
        element: <PrivateRoute appType="dialer" />,
      },
      {
        path: "/ivr/connect",
        element: <ConnectForm appType="ivr" />,
      },
      {
        path: "/dialer/connect",
        element: <ConnectForm appType="dialer" />,
      },
    ],
  },
]);

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
